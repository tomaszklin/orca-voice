package expo.modules.orcavoicebackground

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener

/**
 * Orca Voice fork: the phone's TTS, voiced like navigation prompts.
 *
 * expo-speech plays with default attributes and asks for no audio focus, so music keeps playing at
 * full volume and some car head units never play the speech at all. Navigation guidance is the
 * usage cars are built around (it is what Google Maps announces with): it rides the same Bluetooth
 * media link and the system ducks other audio while it plays. Focus is held from the first
 * utterance until the queue runs dry.
 */
object ReadAloudSpeech : UtteranceProgressListener() {
  /** (event, utteranceId, message): event is "start", "done" or "error". */
  @Volatile var listener: ((String, String, String?) -> Unit)? = null

  private val attributes: AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

  private var tts: TextToSpeech? = null
  private var ready = false
  private var audioManager: AudioManager? = null
  private var focusRequest: AudioFocusRequest? = null
  private var legacyFocusHeld = false
  private var outstanding = 0
  private val pending = mutableListOf<Pair<String, String>>()
  // Set when the engine failed; it is shut down and rebuilt once the queue is empty, because an
  // engine whose service died (an update, a Bluetooth switch) keeps refusing every utterance.
  private var rebuildEngine = false

  @Synchronized
  fun speak(context: Context, id: String, text: String) {
    if (tts == null) {
      val appContext = context.applicationContext
      audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      tts = TextToSpeech(appContext) { status -> onInit(status) }
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
    outstanding = 0
    tts?.stop()
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
    requestFocus()
    outstanding++
    val result = tts?.speak(text, TextToSpeech.QUEUE_ADD, null, id) ?: TextToSpeech.ERROR
    if (result != TextToSpeech.SUCCESS) {
      rebuildEngine = true
      listener?.invoke("error", id, "text-to-speech refused the text")
      finishOne()
    }
  }

  override fun onStart(utteranceId: String) {
    listener?.invoke("start", utteranceId, null)
  }

  override fun onDone(utteranceId: String) {
    listener?.invoke("done", utteranceId, null)
    finishOne()
  }

  @Deprecated("Deprecated in Java")
  override fun onError(utteranceId: String) {
    rebuildEngine = true
    listener?.invoke("error", utteranceId, "text-to-speech failed")
    finishOne()
  }

  override fun onError(utteranceId: String, errorCode: Int) {
    rebuildEngine = true
    listener?.invoke("error", utteranceId, "text-to-speech failed ($errorCode)")
    finishOne()
  }

  override fun onStop(utteranceId: String, interrupted: Boolean) {
    finishOne()
  }

  @Synchronized
  private fun finishOne() {
    outstanding = (outstanding - 1).coerceAtLeast(0)
    if (outstanding == 0) {
      abandonFocus()
      if (rebuildEngine) {
        rebuildEngine = false
        tts?.shutdown()
        tts = null
        ready = false
      }
    }
  }

  private fun requestFocus() {
    val manager = audioManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      if (focusRequest != null) return
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attributes)
        .build()
      manager.requestAudioFocus(request)
      focusRequest = request
    } else if (!legacyFocusHeld) {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
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
      manager.abandonAudioFocus(null)
      legacyFocusHeld = false
    }
  }
}
