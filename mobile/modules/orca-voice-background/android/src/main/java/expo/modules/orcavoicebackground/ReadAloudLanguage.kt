package expo.modules.orcavoicebackground

import android.content.Context
import android.os.Build
import android.view.textclassifier.TextClassificationManager
import android.view.textclassifier.TextLanguage

/**
 * Orca Voice fork: the language of a sentence, so one in another language can be read in its own
 * voice (2026-10-28). Android's on-device language detection (Android 10+), with no network.
 */
object ReadAloudLanguage {
  /** (language tag, confidence 0–1) of the likeliest language per text; null where unknown. */
  fun detect(context: Context, texts: List<String>): List<Map<String, Any>?> {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return texts.map { null }
    val classifier = runCatching {
      context.getSystemService(TextClassificationManager::class.java)?.textClassifier
    }.getOrNull() ?: return texts.map { null }
    return texts.map { text ->
      runCatching {
        val result = classifier.detectLanguage(TextLanguage.Request.Builder(text).build())
        (0 until result.localeHypothesisCount)
          .map { result.getLocale(it) }
          .maxByOrNull { result.getConfidenceScore(it) }
          ?.let { locale ->
            mapOf(
              "language" to locale.toLanguageTag(),
              "confidence" to result.getConfidenceScore(locale).toDouble()
            )
          }
      }.getOrNull()
    }
  }
}
