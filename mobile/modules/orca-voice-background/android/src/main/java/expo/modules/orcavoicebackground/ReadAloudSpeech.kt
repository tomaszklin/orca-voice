package expo.modules.orcavoicebackground

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener

/**
 * Orca Voice fork: the phone's TTS, voiced like navigation prompts.
 *
 * expo-speech plays with default attributes and asks for no audio focus, so music keeps playing at
 * full volume and some car head units never play the speech at all. Navigation guidance is the
 * usage cars are built around (it is what Google Maps announces with): it rides the same Bluetooth
 * media link and the system ducks other audio while it plays. Focus is held from the first
 * utterance until the queue runs dry, plus a short grace so music does not swell back between
 * the pieces of one reply. Like a music player it gives way to dictation and calls: losing focus
 * stops the reading, and nothing starts while someone is talking into the mic (2026-10-21).
 */
object ReadAloudSpeech : UtteranceProgressListener() {
  /**
   * (event, utteranceId, message): "start", "done" or "error" for one utterance, "waiting" when
   * one is held for the mic, and "interrupted" (no id) when another app took the audio.
   */
  @Volatile var listener: ((String, String, String?) -> Unit)? = null

  private const val FOCUS_GRACE_MS = 1500L
  // A dictation longer than this is unlikely; past it the held reading goes ahead anyway.
  private const val MIC_WAIT_LIMIT_MS = 120_000L
  // What a person talks into: dictation, calls, voice notes. Not the assistant's hotword
  // listener, which some phones keep open all the time.
  private val SPOKEN_SOURCES = setOf(
    MediaRecorder.AudioSource.MIC,
    MediaRecorder.AudioSource.CAMCORDER,
    MediaRecorder.AudioSource.VOICE_RECOGNITION,
    MediaRecorder.AudioSource.VOICE_COMMUNICATION,
    MediaRecorder.AudioSource.UNPROCESSED,
    MediaRecorder.AudioSource.VOICE_PERFORMANCE
  )

  private val attributes: AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

  private var appContext: Context? = null
  private var tts: TextToSpeech? = null
  private var ready = false
  private var audioManager: AudioManager? = null
  private var focusRequest: AudioFocusRequest? = null
  private var legacyFocusHeld = false
  // Utterances handed to the engine and not finished yet. Ids, not a count: a stopped
  // utterance's late onStop must not end the one that replaced it.
  private val active = mutableSetOf<String>()
  private val pending = mutableListOf<Pair<String, String>>()
  // Set when the engine failed; it is shut down and rebuilt once the queue is empty, because an
  // engine whose service died (an update, a Bluetooth switch) keeps refusing every utterance.
  private var rebuildEngine = false
  private val handler = Handler(Looper.getMainLooper())
  private val releaseFocus = Runnable {
    synchronized(ReadAloudSpeech) { if (active.isEmpty()) abandonFocus() }
  }
  private val heldForMic = mutableListOf<Pair<String, String>>()
  private var recordingCallback: AudioManager.AudioRecordingCallback? = null
  private val micWaitLimit = Runnable { synchronized(ReadAloudSpeech) { releaseHeld() } }
  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
      stop()
      listener?.invoke("interrupted", "", "another app took the audio")
    }
  }

  @Synchronized
  fun speak(context: Context, id: String, text: String) {
    appContext = context.applicationContext
    // Behind the mic, and behind whatever is already held for it, so pieces keep their order.
    if (heldForMic.isNotEmpty() || micBusy(context)) {
      heldForMic.add(id to text)
      watchMic()
      listener?.invoke("waiting", id, null)
      return
    }
    speakNow(id, text)
  }

  private fun speakNow(id: String, text: String) {
    val context = appContext ?: return
    if (tts == null) {
      audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      tts = TextToSpeech(context) { status -> onInit(status) }
    }
    if (!ready) {
      pending.add(id to text)
      return
    }
    enqueue(id, text)
  }

  @Synchronized
  fun stop() {
    pending.clear()
    heldForMic.clear()
    stopWatchingMic()
    // Forgotten first, so the onStop callbacks this stop causes read as asked for.
    active.clear()
    tts?.stop()
    handler.removeCallbacks(releaseFocus)
    abandonFocus()
  }

  @Synchronized
  private fun onInit(status: Int) {
    ready = status == TextToSpeech.SUCCESS
    val queued = pending.toList()
    pending.clear()
    if (!ready) {
      queued.forEach { (id, _) -> listener?.invoke("error", id, "text-to-speech engine did not start") }
      tts = null
      return
    }
    tts?.setAudioAttributes(attributes)
    tts?.setOnUtteranceProgressListener(this)
    queued.forEach { (id, text) -> enqueue(id, text) }
  }

  private fun enqueue(id: String, text: String) {
    handler.removeCallbacks(releaseFocus)
    requestFocus()
    active.add(id)
    val result = tts?.speak(text, TextToSpeech.QUEUE_ADD, null, id) ?: TextToSpeech.ERROR
    if (result != TextToSpeech.SUCCESS) {
      fail(id, "text-to-speech refused the text")
    }
  }

  override fun onStart(utteranceId: String) {
    listener?.invoke("start", utteranceId, null)
  }

  override fun onDone(utteranceId: String) {
    if (finish(utteranceId)) {
      listener?.invoke("done", utteranceId, null)
    }
  }

  @Deprecated("Deprecated in Java")
  override fun onError(utteranceId: String) {
    fail(utteranceId, "text-to-speech failed")
  }

  override fun onError(utteranceId: String, errorCode: Int) {
    fail(utteranceId, "text-to-speech failed ($errorCode)")
  }

  override fun onStop(utteranceId: String, interrupted: Boolean) {
    // stop() already forgot its ids, so one still active was cut off by something else, and the
    // reader would otherwise wait for it forever.
    fail(utteranceId, "text-to-speech was stopped by the system")
  }

  /** Finished before the reader hears of it, so a retry it sends lands on a rebuilt engine. */
  private fun fail(id: String, message: String) {
    synchronized(this) { rebuildEngine = true }
    if (finish(id)) {
      listener?.invoke("error", id, message)
    }
  }

  /** False when the id already finished or was stopped on purpose. */
  @Synchronized
  private fun finish(id: String): Boolean {
    if (!active.remove(id)) {
      return false
    }
    if (active.isEmpty()) {
      handler.removeCallbacks(releaseFocus)
      handler.postDelayed(releaseFocus, FOCUS_GRACE_MS)
      if (rebuildEngine) {
        rebuildEngine = false
        tts?.shutdown()
        tts = null
        ready = false
      }
    }
    return true
  }

  private fun micBusy(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    return manager.activeRecordingConfigurations.any { it.clientAudioSource in SPOKEN_SOURCES }
  }

  private fun watchMic() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || recordingCallback != null) return
    val context = appContext ?: return
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val callback = object : AudioManager.AudioRecordingCallback() {
      override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>?) {
        synchronized(ReadAloudSpeech) {
          if (!micBusy(context)) releaseHeld()
        }
      }
    }
    manager.registerAudioRecordingCallback(callback, handler)
    recordingCallback = callback
    handler.postDelayed(micWaitLimit, MIC_WAIT_LIMIT_MS)
  }

  private fun stopWatchingMic() {
    handler.removeCallbacks(micWaitLimit)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      val manager = appContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      recordingCallback?.let { manager?.unregisterAudioRecordingCallback(it) }
    }
    recordingCallback = null
  }

  private fun releaseHeld() {
    stopWatchingMic()
    val held = heldForMic.toList()
    heldForMic.clear()
    held.forEach { (id, text) -> speakNow(id, text) }
  }

  private fun requestFocus() {
    val manager = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      if (focusRequest != null) return
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attributes)
        .setOnAudioFocusChangeListener(focusListener, handler)
        .build()
      manager.requestAudioFocus(request)
      focusRequest = request
    } else if (!legacyFocusHeld) {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      legacyFocusHeld = true
    }
  }

  private fun abandonFocus() {
    val manager = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      focusRequest?.let { manager.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else if (legacyFocusHeld) {
      @Suppress("DEPRECATION")
      manager.abandonAudioFocus(focusListener)
      legacyFocusHeld = false
    }
  }
}
