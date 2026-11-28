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

  // The watch app's id from its manifest, plain and in the dashed form the SDK's samples use.
  private val APP_IDS = listOf(
    "95cae03779794fb2a2083a15b2848da5",
    "95cae037-7979-4fb2-a208-3a15b2848da5"
  )

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
            Log.w(TAG, "Connect IQ not available: $status")
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
    val devices = try {
      ciq.knownDevices.orEmpty()
    } catch (e: Exception) {
      Log.w(TAG, "No Garmin devices", e)
      return
    }
    Log.i(TAG, "Listening on ${devices.size} Garmin device(s)")
    for (device in devices) {
      register(context, ciq, device)
      try {
        ciq.registerForDeviceEvents(device) { changed, status ->
          Log.i(TAG, "${changed.friendlyName}: $status")
          if (status == IQDevice.IQDeviceStatus.CONNECTED) register(context, ciq, changed)
        }
      } catch (e: Exception) {
        Log.w(TAG, "No device events for ${device.friendlyName}", e)
      }
    }
  }

  private fun register(context: Context, ciq: ConnectIQ, device: IQDevice) {
    for (id in APP_IDS) {
      try {
        ciq.registerForAppEvents(device, IQApp(id)) { _, _, messages, status ->
          Log.i(TAG, "From ${device.friendlyName}: $status $messages")
          if (status == ConnectIQ.IQMessageStatus.SUCCESS) messages.forEach { handle(context, it) }
        }
      } catch (e: Exception) {
        Log.w(TAG, "Could not listen for $id on ${device.friendlyName}", e)
      }
    }
  }

  private fun handle(context: Context, message: Any?) {
    val map = message as? Map<*, *> ?: return
    val event = map["event"] as? String ?: return
    val session = map["session"] as? String ?: ""
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
