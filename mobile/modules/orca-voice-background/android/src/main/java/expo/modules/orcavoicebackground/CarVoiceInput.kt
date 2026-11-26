package expo.modules.orcavoicebackground

import android.content.Intent
import android.media.AudioFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.car.app.CarContext
import androidx.car.app.media.CarAudioRecord

/**
 * Orca Voice fork: one spoken reply in Android Auto. Android Auto owns the microphone while the
 * phone projects, so on car API 5+ and Android 13+ the car's microphone is piped into the phone's
 * recognizer; otherwise the recognizer listens itself. Each attempt owns its recording.
 */
class CarVoiceInput(private val carContext: CarContext) {
  private val main = Handler(Looper.getMainLooper())
  private var attempt: Attempt? = null

  private inner class Attempt(private val onDone: (String?, String?) -> Unit) {
    var recognizer: SpeechRecognizer? = null
    var record: CarAudioRecord? = null
    @Volatile var pumping = false
    private var finished = false

    fun finish(text: String?, error: String?) {
      main.post {
        if (finished) return@post
        finished = true
        release()
        if (attempt === this) attempt = null
        onDone(text, error)
      }
    }

    fun release() {
      pumping = false
      runCatching { record?.stopRecording() }
      record = null
      recognizer?.destroy()
      recognizer = null
    }

    fun drop() {
      finished = true
      release()
    }
  }

  /** `onDone(text, error)`: the words heard, or null and an error to show (null: nothing heard). */
  fun listen(onDone: (String?, String?) -> Unit) {
    cancel()
    val current = Attempt(onDone)
    attempt = current
    if (!SpeechRecognizer.isRecognitionAvailable(carContext)) {
      current.finish(null, CarWords.noRecognizer)
      return
    }
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && carContext.carAppApiLevel >= 5) {
      // Without the car's microphone (no permission, an old host) the recognizer's own one may do.
      runCatching { pipeCarMicrophone(current, intent) }.onFailure { current.release() }
    }
    val speech = SpeechRecognizer.createSpeechRecognizer(carContext)
    current.recognizer = speech
    speech.setRecognitionListener(object : RecognitionListener {
      override fun onResults(results: Bundle?) {
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
          ?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
        current.finish(text, null)
      }

      override fun onError(error: Int) {
        val nothingHeard = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
        current.finish(null, if (nothingHeard) null else "${CarWords.recognizerFailed} ($error)")
      }

      override fun onEndOfSpeech() {
        current.pumping = false
      }

      override fun onReadyForSpeech(params: Bundle?) = Unit
      override fun onBeginningOfSpeech() = Unit
      override fun onRmsChanged(rmsdB: Float) = Unit
      override fun onBufferReceived(buffer: ByteArray?) = Unit
      override fun onPartialResults(partialResults: Bundle?) = Unit
      override fun onEvent(eventType: Int, params: Bundle?) = Unit
    })
    speech.startListening(intent)
  }

  private fun pipeCarMicrophone(current: Attempt, intent: Intent) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val record = CarAudioRecord.create(carContext)
    val (source, sink) = ParcelFileDescriptor.createPipe()
    current.record = record
    record.startRecording()
    current.pumping = true
    Thread {
      val buffer = ByteArray(CarAudioRecord.AUDIO_CONTENT_BUFFER_SIZE)
      // Until the recognizer hears the end of speech, the attempt ends, or 30 s at most.
      val until = System.currentTimeMillis() + 30_000
      ParcelFileDescriptor.AutoCloseOutputStream(sink).use { out ->
        runCatching {
          while (current.pumping && System.currentTimeMillis() < until) {
            val read = record.read(buffer, 0, buffer.size)
            if (read < 0) break
            if (read > 0) out.write(buffer, 0, read)
          }
        }
      }
      runCatching { record.stopRecording() }
    }.start()
    intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, source)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, CarAudioRecord.AUDIO_CONTENT_SAMPLING_RATE)
  }

  fun cancel() {
    attempt?.drop()
    attempt = null
  }
}
