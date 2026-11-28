package expo.modules.orcavoicebackground

import android.content.Context
import android.media.AudioAttributes
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.util.Log
import com.garmin.android.connectiq.ConnectIQ
import com.garmin.android.connectiq.IQApp
import com.garmin.android.connectiq.IQDevice
import java.util.Locale

/**
 * Orca Voice fork, prototype: hears the Orca Remote watch app (voice/garmin/orca-remote), which
 * sits on a Garmin watch's music controls, and says aloud what was pressed. It only proves that
 * the presses reach the phone during a run; nothing acts on them yet.
 */
object GarminRemote {
  private const val TAG = "OrcaGarmin"

  // The watch app's id from its manifest (the SDK strips dashes, so one form is enough).
  private val APP_IDS = listOf("95cae03779794fb2a2083a15b2848da5")

  private val main = Handler(Looper.getMainLooper())
  private var connectIQ: ConnectIQ? = null
  private var speech: TextToSpeech? = null
  private var speechReady = false
  private var pending: String? = null

  fun start(context: Context) {
    val app = context.applicationContext
    main.post {
      if (connectIQ != null) return@post
      val ciq = ConnectIQ.getInstance(app, ConnectIQ.IQConnectType.WIRELESS)
      connectIQ = ciq
      try {
        ciq.initialize(app, false, object : ConnectIQ.ConnectIQListener {
          override fun onSdkReady() = listen(app, ciq)

          override fun onInitializeError(status: ConnectIQ.IQSdkErrorStatus) {
            note(app, "Connect IQ not available: $status")
            connectIQ = null
          }

          override fun onSdkShutDown() {
            connectIQ = null
          }
        })
      } catch (e: Exception) {
        Log.w(TAG, "Connect IQ failed to start", e)
        connectIQ = null
      }
    }
  }

  private fun listen(context: Context, ciq: ConnectIQ) {
    val onMessage = ConnectIQ.IQApplicationEventListener { device, app, messages, status ->
      note(context, "From ${device.friendlyName}: $status $messages")
      if (status == ConnectIQ.IQMessageStatus.SUCCESS) messages.forEach { handle(context, ciq, device, app, it) }
    }
    // Garmin Connect broadcasts messages to the per-device listeners below (build 86-87 got them
    // that way). Build 88 asked it to bind to IQGarminBindingService instead, after which nothing
    // arrived; build 89 withdrew that request (the withdrawal also shuts the SDK down, so it is
    // not repeated). The app-wide listener stays in case Garmin Connect binds anyway.
    try {
      ciq.registerForAppEvents(onMessage)
    } catch (e: Exception) {
      note(context, "App-wide listener failed: $e")
    }
    val devices = try {
      ciq.knownDevices.orEmpty()
    } catch (e: Exception) {
      Log.w(TAG, "No Garmin devices", e)
      return
    }
    note(context, "Listening on ${devices.size} Garmin device(s)")
    for (device in devices) {
      note(context, "${device.friendlyName}: ${runCatching { ciq.getDeviceStatus(device) }.getOrNull()}")
      register(ciq, device, onMessage)
      try {
        ciq.getApplicationInfo(APP_IDS[0], device, object : ConnectIQ.IQApplicationInfoListener {
          override fun onApplicationInfoReceived(app: IQApp) =
            note(context, "Watch app ${app.status} v${app.version()} on ${device.friendlyName}")

          override fun onApplicationNotInstalled(id: String) =
            note(context, "Watch app not installed on ${device.friendlyName}")
        })
      } catch (e: Exception) {
        note(context, "App info failed: $e")
      }
      try {
        ciq.registerForDeviceEvents(device) { changed, status ->
          note(context, "${changed.friendlyName}: $status")
          if (status == IQDevice.IQDeviceStatus.CONNECTED) register(ciq, changed, onMessage)
        }
      } catch (e: Exception) {
        Log.w(TAG, "No device events for ${device.friendlyName}", e)
      }
    }
  }

  private fun register(ciq: ConnectIQ, device: IQDevice, onMessage: ConnectIQ.IQApplicationEventListener) {
    try {
      ciq.registerForAppEvents(device, IQApp(APP_IDS[0]), onMessage)
    } catch (e: Exception) {
      Log.w(TAG, "Could not listen on ${device.friendlyName}", e)
    }
  }

  /** Logcat rotates fast in this app, so the same lines also go to a file adb can read. */
  private fun note(context: Context, text: String) {
    Log.i(TAG, text)
    try {
      val file = java.io.File(context.getExternalFilesDir(null), "garmin-remote.log")
      if (file.length() > 64_000) file.delete()
      val time = java.text.SimpleDateFormat("MM-dd HH:mm:ss", Locale.US).format(java.util.Date())
      file.appendText("$time $text\n")
    } catch (_: Exception) {
    }
  }

  private var lastMessage: String? = null
  private var lastMessageAt = 0L

  private fun handle(context: Context, ciq: ConnectIQ, device: IQDevice, app: IQApp, message: Any?) {
    val map = message as? Map<*, *> ?: return
    val event = map["event"] as? String ?: return
    val session = map["session"] as? String ?: ""
    // Both delivery paths may carry the same message; say it once.
    val key = "$event/$session"
    val now = System.currentTimeMillis()
    if (key == lastMessage && now - lastMessageAt < 1500) return
    lastMessage = key
    lastMessageAt = now
    // Tells the watch's log that the phone got it, whatever happens to the speech.
    try {
      ciq.sendMessage(device, app, mapOf("ack" to event)) { _, _, status ->
        note(context, "Ack $event: $status")
      }
    } catch (e: Exception) {
      note(context, "Ack failed: $e")
    }
    val text = when (event) {
      "nastepna" -> "Następna sesja: $session"
      "poprzednia" -> "Poprzednia sesja: $session"
      "pauza" -> "Pauza, sesja $session"
      "wznow" -> "Wznowienie, sesja $session"
      "kciuk-gora" -> "Kciuk w górę, sesja $session"
      "kciuk-dol" -> "Kciuk w dół, sesja $session"
      "test" -> "Test z zegarka"
      else -> "Zegarek: $event"
    }
    main.post { say(context, text) }
  }

  private fun say(context: Context, text: String) {
    val engine = speech
    if (engine != null && speechReady) {
      engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "garmin-remote")
      return
    }
    pending = text
    if (engine != null) return
    speech = TextToSpeech(context) { status ->
      main.post {
        val tts = speech ?: return@post
        if (status != TextToSpeech.SUCCESS) {
          Log.w(TAG, "No speech engine: $status")
          speech = null
          return@post
        }
        tts.language = Locale("pl", "PL")
        tts.setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        speechReady = true
        pending?.let { tts.speak(it, TextToSpeech.QUEUE_FLUSH, null, "garmin-remote") }
        pending = null
      }
    }
  }
}
