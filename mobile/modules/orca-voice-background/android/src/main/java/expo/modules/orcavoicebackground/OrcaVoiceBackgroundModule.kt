package expo.modules.orcavoicebackground

import android.content.Intent
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Orca Voice fork: starts and stops [ReadAloudService], forwards its ticks to JS, speaks
 * through [ReadAloudSpeech], and installs updates through [UpdateInstaller].
 */
class OrcaVoiceBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OrcaVoiceBackground")

    Events("onTick", "onSpeech", "onMuteToggle")

    // Wired at creation rather than on first observer: a module instance exists only while the
    // app's JS runs, which is exactly what the sticky service checks the ticker listener for.
    OnCreate {
      ReadAloudTicker.listener = { sendEvent("onTick", emptyMap<String, Any>()) }
      ReadAloudSpeech.listener = { event, id, message ->
        sendEvent("onSpeech", mapOf("event" to event, "id" to id, "message" to message))
      }
      ReadAloudControls.listener = { sendEvent("onMuteToggle", emptyMap<String, Any>()) }
    }

    /** False when Android refused the service, e.g. a start attempted from the background. */
    Function("start") { title: String, text: String, tickMs: Double ->
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, ReadAloudService::class.java)
        .putExtra(ReadAloudService.EXTRA_TITLE, title)
        .putExtra(ReadAloudService.EXTRA_TEXT, text)
        .putExtra(ReadAloudService.EXTRA_TICK_MS, tickMs.toLong())
      try {
        ContextCompat.startForegroundService(context, intent)
        true
      } catch (_: Exception) {
        false
      }
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function false
      context.stopService(Intent(context, ReadAloudService::class.java))
    }

    Function("isRunning") { ReadAloudService.isRunning }

    /** Queues one utterance; its progress comes back as `onSpeech` events carrying the id. */
    Function("speak") { id: String, text: String ->
      val context = appContext.reactContext ?: return@Function false
      ReadAloudSpeech.speak(context, id, text)
      true
    }

    Function("stopSpeech") {
      ReadAloudSpeech.stop()
    }

    /** `rate` 1 = normal; null rate or voice = the phone's text-to-speech setting. */
    Function("getSpeechOptions") {
      val context = appContext.reactContext ?: return@Function null
      val (rate, voice) = ReadAloudSpeech.options(context)
      mapOf(
        "rate" to rate?.toDouble(),
        "voice" to voice,
        "phoneRate" to ReadAloudSpeech.systemRate(context).toDouble()
      )
    }

    Function("setSpeechOptions") { rate: Double?, voice: String? ->
      val context = appContext.reactContext ?: return@Function false
      ReadAloudSpeech.setOptions(context, rate?.toFloat(), voice)
      true
    }

    /** Null when the engine did not start. */
    AsyncFunction("getVoices") { promise: Promise ->
      val context = appContext.reactContext ?: return@AsyncFunction promise.resolve(null)
      ReadAloudSpeech.withEngine(context) { engine ->
        promise.resolve(ReadAloudSpeech.describeVoices(engine))
      }
    }

    /** The phone's text-to-speech settings: engine, more voices to download. */
    Function("openTtsSettings") {
      val context = appContext.reactContext ?: return@Function false
      listOf("com.android.settings.TTS_SETTINGS", Settings.ACTION_ACCESSIBILITY_SETTINGS).any { action ->
        try {
          context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (_: Exception) {
          false
        }
      }
    }

    /** Downloads a build from the home server and opens the installer; false if one is running. */
    Function("installUpdate") { url: String ->
      val context = appContext.reactContext ?: return@Function false
      UpdateInstaller.start(context, url)
    }

    /** What the notification's Mute button shows; the mute itself lives in JS. */
    Function("setMuted") { muted: Boolean ->
      ReadAloudService.showMuted(muted)
    }

    OnDestroy {
      ReadAloudTicker.listener = null
      ReadAloudSpeech.listener = null
      ReadAloudControls.listener = null
    }
  }
}
