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
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

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
  private const val PREFS = "orca-voice-speech"
  private const val PREF_RATE = "rate"
  private const val PREF_VOICE = "voice"
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
  // Callers waiting for the engine to start, e.g. the voice list opened before anything was read.
  private val whenReady = mutableListOf<(TextToSpeech?) -> Unit>()
  // Whether this engine was given our rate or voice, so going back to the phone's setting resets it.
  private var rateApplied = false
  private var voiceApplied = false
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
    ensureEngine(context)
    if (!ready) {
      pending.add(id to text)
      return
    }
    enqueue(id, text)
  }

  private fun ensureEngine(context: Context) {
    if (tts == null) {
      audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      tts = TextToSpeech(context) { status -> onInit(status) }
    }
  }

  /** Calls back with the started engine, or with null when it could not start. */
  @Synchronized
  fun withEngine(context: Context, callback: (TextToSpeech?) -> Unit) {
    val app = context.applicationContext
    appContext = app
    if (ready && tts != null) {
      callback(tts)
      return
    }
    whenReady.add(callback)
    ensureEngine(app)
  }

  /** The rate (1 = normal) and voice name chosen in Orca; null means the phone's setting. */
  fun options(context: Context): Pair<Float?, String?> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return prefs.getFloat(PREF_RATE, 0f).takeIf { it > 0f } to prefs.getString(PREF_VOICE, null)
  }

  /** Kept natively, so the first reading after a restart already uses them. */
  @Synchronized
  fun setOptions(context: Context, rate: Float?, voice: String?) {
    appContext = context.applicationContext
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
      if (rate == null) remove(PREF_RATE) else putFloat(PREF_RATE, rate)
      if (voice == null) remove(PREF_VOICE) else putString(PREF_VOICE, voice)
    }.apply()
    if (ready) applyOptions()
  }

  /** Installed voices, the engine's default one, and the language it reads in by default. */
  fun describeVoices(engine: TextToSpeech?): Map<String, Any?>? {
    engine ?: return null
    // Some engines throw from these instead of returning null.
    val voices = runCatching { engine.voices }.getOrNull().orEmpty()
    val default = runCatching { engine.defaultVoice }.getOrNull()
    return mapOf(
      "voices" to voices.map { voice ->
        mapOf(
          "name" to voice.name,
          "language" to voice.locale.toLanguageTag(),
          "needsInternet" to voice.isNetworkConnectionRequired,
          "installed" to !voice.features.orEmpty().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
        )
      },
      "defaultVoice" to default?.name,
      "language" to (default?.locale ?: Locale.getDefault()).toLanguageTag()
    )
  }

  /** Reaches the next piece; the one playing keeps what it was queued with. */
  private fun applyOptions() {
    val engine = tts ?: return
    val context = appContext ?: return
    val (rate, voiceName) = options(context)
    if (rate != null || rateApplied) {
      engine.setSpeechRate(rate ?: systemRate(context))
      rateApplied = rate != null
    }
    val voice = voiceName?.let { name ->
      runCatching { engine.voices }.getOrNull()?.firstOrNull { it.name == name }
    }
    if (voice != null) {
      engine.setVoice(voice)
      voiceApplied = true
    } else if (voiceApplied) {
      runCatching { engine.defaultVoice }.getOrNull()?.let { engine.setVoice(it) }
      voiceApplied = false
    }
  }

  // What the engine uses when it is given no rate (100 = normal).
  fun systemRate(context: Context): Float =
    Settings.Secure.getInt(context.contentResolver, Settings.Secure.TTS_DEFAULT_RATE, 100) / 100f

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
    val waiting = whenReady.toList()
    whenReady.clear()
    if (!ready) {
      queued.forEach { (id, _) -> listener?.invoke("error", id, "text-to-speech engine did not start") }
      tts = null
      waiting.forEach { it(null) }
      return
    }
    tts?.setAudioAttributes(attributes)
    tts?.setOnUtteranceProgressListener(this)
    // A new engine starts from the phone's settings.
    rateApplied = false
    voiceApplied = false
    applyOptions()
    waiting.forEach { it(tts) }
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
