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
import java.io.IOException

/**
 * Orca Voice fork: one spoken reply in Android Auto. Android Auto owns the microphone while the
 * phone projects, so the sound comes from the car through [CarAudioRecord] (car API 5) and is
 * piped into the phone's speech recognizer (Android 13+ takes an audio source). On older hosts or
 * phones it falls back to the recognizer's own microphone.
 */
class CarVoiceInput(private val carContext: CarContext) {
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var recorder: CarAudioRecord? = null
  @Volatile private var pumping = false
  private var done: ((String?, String?) -> Unit)? = null

  /** `onDone(text, error)`: text when something was heard, else an error to show. */
  fun listen(onDone: (String?, String?) -> Unit) {
    cancel()
    done = onDone
    if (!SpeechRecognizer.isRecognitionAvailable(carContext)) {
      finish(null, "No speech recognition on the phone.")
      return
    }
    val carMic = carContext.carAppApiLevel >= 5 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
      .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    if (carMic) {
      try {
        attachCarMicrophone(intent)
      } catch (error: Exception) {
        // No car microphone (permission, host): the recognizer's own one may still work.
        stopRecorder()
      }
    }
    val speech = SpeechRecognizer.createSpeechRecognizer(carContext)
    recognizer = speech
    speech.setRecognitionListener(object : RecognitionListener {
      override fun onResults(results: Bundle?) {
        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
          ?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
        finish(text, null)
      }

      override fun onError(error: Int) {
        finish(null, if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) null else "Speech recognition failed ($error).")
      }

      override fun onEndOfSpeech() {
        pumping = false
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

  private fun attachCarMicrophone(intent: Intent) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
      return
    }
    val record = CarAudioRecord.create(carContext)
    val (source, sink) = ParcelFileDescriptor.createPipe()
    recorder = record
    record.startRecording()
    pumping = true
    Thread {
      val buffer = ByteArray(CarAudioRecord.AUDIO_CONTENT_BUFFER_SIZE)
      ParcelFileDescriptor.AutoCloseOutputStream(sink).use { out ->
        try {
          // Ends when the recognizer hears the end of speech, or after 30 s at most.
          val until = System.currentTimeMillis() + 30_000
          while (pumping && System.currentTimeMillis() < until) {
            val read = record.read(buffer, 0, buffer.size)
            if (read < 0) {
              break
            }
            if (read > 0) {
              out.write(buffer, 0, read)
            }
          }
        } catch (_: Exception) {
          // The recognizer closed its end, or the recording was stopped.
        }
      }
      main.post { stopRecorder() }
    }.start()
    intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, source)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, CarAudioRecord.AUDIO_CONTENT_SAMPLING_RATE)
  }

  private fun finish(text: String?, error: String?) {
    val callback = done ?: return
    done = null
    main.post {
      release()
      callback(text, error)
    }
  }

  private fun stopRecorder() {
    pumping = false
    try {
      recorder?.stopRecording()
    } catch (_: Exception) {
    }
    recorder = null
  }

  private fun release() {
    stopRecorder()
    recognizer?.destroy()
    recognizer = null
  }

  fun cancel() {
    done = null
    release()
  }
}
