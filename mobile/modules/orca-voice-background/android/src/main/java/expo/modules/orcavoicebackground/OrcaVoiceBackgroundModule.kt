package expo.modules.orcavoicebackground

import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Orca Voice fork: starts and stops [ReadAloudService] and forwards its ticks to JS. */
class OrcaVoiceBackgroundModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OrcaVoiceBackground")

    Events("onTick")

    OnStartObserving {
      ReadAloudTicker.listener = { sendEvent("onTick", emptyMap<String, Any>()) }
    }

    OnStopObserving {
      ReadAloudTicker.listener = null
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

    OnDestroy {
      ReadAloudTicker.listener = null
    }
  }
}
