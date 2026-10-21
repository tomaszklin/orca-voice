package expo.modules.orcavoicebackground

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Orca Voice fork: starts and stops [ReadAloudService], forwards its ticks to JS, speaks
 * through [ReadAloudSpeech], and opens the phone's own dictation for the chat's mic.
 */
class OrcaVoiceBackgroundModule : Module() {
  private var pendingRecognition: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("OrcaVoiceBackground")

    Events("onTick", "onSpeech")

    // Wired at creation rather than on first observer: a module instance exists only while the
    // app's JS runs, which is exactly what the sticky service checks the ticker listener for.
    OnCreate {
      ReadAloudTicker.listener = { sendEvent("onTick", emptyMap<String, Any>()) }
      ReadAloudSpeech.listener = { event, id, message ->
        sendEvent("onSpeech", mapOf("event" to event, "id" to id, "message" to message))
      }
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

    /**
     * The system speech-recognition dialog (the voice typing the keyboard's mic opens), in the
     * phone's language. Resolves with the recognised text, or null when cancelled or unavailable.
     */
    AsyncFunction("recognizeSpeech") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      pendingRecognition?.resolve(null)
      pendingRecognition = promise
      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      try {
        activity.startActivityForResult(intent, RECOGNIZE_SPEECH_REQUEST)
      } catch (_: ActivityNotFoundException) {
        pendingRecognition = null
        promise.resolve(null)
      }
    }.runOnQueue(Queues.MAIN)

    OnActivityResult { _, payload ->
      if (payload.requestCode != RECOGNIZE_SPEECH_REQUEST) return@OnActivityResult
      val promise = pendingRecognition ?: return@OnActivityResult
      pendingRecognition = null
      val text = if (payload.resultCode == Activity.RESULT_OK) {
        payload.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
      } else {
        null
      }
      promise.resolve(text)
    }

    OnDestroy {
      ReadAloudTicker.listener = null
      ReadAloudSpeech.listener = null
      pendingRecognition?.resolve(null)
      pendingRecognition = null
    }
  }

  private companion object {
    const val RECOGNIZE_SPEECH_REQUEST = 7418
  }
}
