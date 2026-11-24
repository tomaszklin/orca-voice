package expo.modules.orcavoicebackground

import android.content.Intent
import android.provider.Settings
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

    Events(
      "onTick", "onSpeech", "onAutoReadToggle", "onReaderControl", "onUpdateDownload",
      "onCarReply", "onCarConnection", "onCarAction"
    )

    // Wired at creation rather than on first observer: a module instance exists only while the
    // app's JS runs, which is exactly what the sticky service checks the ticker listener for.
    OnCreate {
      ReadAloudTicker.listener = { sendEvent("onTick", emptyMap<String, Any>()) }
      ReadAloudSpeech.listener = { event, id, message ->
        sendEvent("onSpeech", mapOf("event" to event, "id" to id, "message" to message))
      }
      ReadAloudControls.listener = { control ->
        if (control == ReadAloudControls.TOGGLE_AUTO_READ) {
          sendEvent("onAutoReadToggle", emptyMap<String, Any>())
        } else {
          sendEvent("onReaderControl", mapOf("action" to control))
        }
      }
      UpdateInstaller.listener = { event, percent, message ->
        sendEvent("onUpdateDownload", mapOf("event" to event, "percent" to percent, "message" to message))
      }
      CarMessaging.connectionListener = { connected ->
        sendEvent("onCarConnection", mapOf("connected" to connected))
      }
      CarMessaging.replyListener = { conversation, text ->
        sendEvent("onCarReply", mapOf("conversation" to conversation, "text" to text))
      }
      CarState.actionListener = { action, paneKey, text ->
        sendEvent("onCarAction", mapOf("action" to action, "paneKey" to paneKey, "text" to text))
      }
      appContext.reactContext?.let {
        ReadAloudOutput.watch(it)
        UpdateInstaller.dismissUpdated(it)
        CarMessaging.watch(it)
      }
    }

    /** Whether the phone is connected to Android Auto (or runs in a car's own Android). */
    Function("isCarConnected") {
      appContext.reactContext?.let { CarMessaging.watch(it) }
      CarMessaging.connected
    }

    /** Adds an agent's message to its conversation in the car; `conversation` is the pane. */
    Function("postCarMessage") { conversation: String, title: String, text: String ->
      val context = appContext.reactContext ?: return@Function false
      CarMessaging.post(context, conversation, title, text)
      true
    }

    /** The agents Orca's car screen lists: maps with paneKey, project, state, message. */
    Function("setCarAgents") { agents: List<Map<String, Any?>> ->
      CarState.setAgents(
        agents.mapNotNull { entry ->
          val paneKey = entry["paneKey"] as? String ?: return@mapNotNull null
          CarAgent(
            paneKey,
            entry["project"] as? String ?: "Orca",
            entry["state"] as? String ?: "",
            entry["message"] as? String
          )
        }
      )
    }

    /** How a reply from the car screen went; shown there as a toast. */
    Function("carReplyResult") { ok: Boolean, message: String ->
      CarState.replyResult(ok, message)
    }

    /** Ends every car conversation, e.g. when the setting is switched off. */
    Function("clearCarMessages") {
      appContext.reactContext?.let { CarMessaging.clear(it) }
    }

    /** False when Android refused the service, e.g. a start attempted from the background. */
    Function("start") { tickMs: Double ->
      val context = appContext.reactContext ?: return@Function false
      ReadAloudService.start(context, tickMs.toLong())
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function false
      ReadAloudService.stop(context)
    }

    Function("isRunning") { ReadAloudService.isRunning }

    /** Queues one utterance; its progress comes back as `onSpeech` events carrying the id. */
    Function("speak") { id: String, text: String, language: String? ->
      val context = appContext.reactContext ?: return@Function false
      ReadAloudSpeech.speak(context, id, text, language)
      true
    }

    /** The phone's guess at each text's language, so a sentence can be read in its own voice. */
    Function("detectLanguages") { texts: List<String> ->
      val context = appContext.reactContext ?: return@Function texts.map { null }
      ReadAloudLanguage.detect(context, texts)
    }

    /** Queues the chime before an auto-read message, reported by id like an utterance. */
    Function("chime") { id: String ->
      val context = appContext.reactContext ?: return@Function false
      ReadAloudSpeech.chime(context, id)
      true
    }

    /** How far the utterance got: where the word being read starts, so a pause can go on from it. */
    Function("spokenOffset") { id: String -> ReadAloudSpeech.spokenOffset(id) }

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
        "phoneRate" to ReadAloudSpeech.systemRate(context).toDouble(),
        "language" to ReadAloudSpeech.language(context),
        "recordable" to ReadAloudSpeech.recordable(context)
      )
    }

    Function("setSpeechOptions") { rate: Double?, voice: String? ->
      val context = appContext.reactContext ?: return@Function false
      ReadAloudSpeech.setOptions(context, rate?.toFloat(), voice)
      true
    }

    /** Speech as media audio, so a screen recording captures it; navigation audio otherwise. */
    Function("setRecordable") { on: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      ReadAloudSpeech.setRecordable(context, on)
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

    /** Downloads a build, reported by `onUpdateDownload` events; false if one is running. */
    Function("installUpdate") { url: String ->
      val context = appContext.reactContext ?: return@Function false
      UpdateInstaller.start(context, url)
    }

    Function("openUpdateInstaller") {
      val context = appContext.reactContext ?: return@Function false
      UpdateInstaller.openInstaller(context)
    }

    Function("canInstallUpdates") {
      val context = appContext.reactContext ?: return@Function false
      UpdateInstaller.canInstall(context)
    }

    Function("openInstallPermission") {
      val context = appContext.reactContext ?: return@Function false
      UpdateInstaller.openInstallPermission(context)
    }

    /** What the notification's auto-read button shows; the pause itself lives in JS. */
    Function("setAutoReadPaused") { paused: Boolean ->
      ReadAloudService.showAutoReadPaused(paused)
    }

    /** The reader's state ("idle", "reading", "paused", "stopped") for the notification and the headset. */
    Function("setReaderState") { state: String, title: String?, status: String?, canRepeat: Boolean,
      canPrevious: Boolean, canNext: Boolean, outsideQueue: Boolean ->
      ReadAloudService.showReader(state, status, canRepeat, canPrevious, canNext, outsideQueue)
      CarState.setReader(state)
      appContext.reactContext?.let {
        // Also here, in case there was no context yet when the module was created.
        ReadAloudOutput.watch(it)
        ReadAloudMediaSession.update(it, state, title, canPrevious, canNext)
      }
    }

    /** Whether sound goes to headphones, a car or the like rather than the phone's speaker. */
    Function("isPrivateOutput") {
      val context = appContext.reactContext ?: return@Function true
      ReadAloudOutput.isPrivate(context)
    }

    OnDestroy {
      ReadAloudTicker.listener = null
      ReadAloudSpeech.listener = null
      ReadAloudControls.listener = null
      UpdateInstaller.listener = null
      CarMessaging.replyListener = null
      CarMessaging.connectionListener = null
      CarState.actionListener = null
      // Why: with no JS left to drive them, speech and the service's wake lock would only linger.
      ReadAloudSpeech.stop()
      appContext.reactContext?.let { ReadAloudService.stop(it) }
      ReadAloudOutput.unwatch()
      ReadAloudMediaSession.end()
    }
  }
}
