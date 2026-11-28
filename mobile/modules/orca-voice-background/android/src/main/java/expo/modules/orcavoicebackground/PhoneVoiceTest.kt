package expo.modules.orcavoicebackground

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat

/**
 * Orca Voice fork, prototype: a press on the Garmin watch makes the phone listen once through the
 * headset's microphone, with the screen off, and say back what it understood. Nothing is sent to
 * an agent. It answers whether Orca can take a spoken reply while the phone is in a pocket.
 *
 * Orca records the audio itself and pipes it to the recognizer (Android 13+), as [CarVoiceInput]
 * does with the car's microphone: a recognizer recording on its own would not get the microphone
 * from the background.
 */
object PhoneVoiceTest {
  private const val RATE = 16_000
  private const val MAX_MS = 30_000L

  private val main = Handler(Looper.getMainLooper())
  private var busy = false
  private var busySince = 0L
  @Volatile private var pumping = false
  private var recognizer: SpeechRecognizer? = null
  private var record: AudioRecord? = null

  fun listen(context: Context) {
    // A test that never finished (a speech engine that never answered) frees itself after a minute.
    if (busy && System.currentTimeMillis() - busySince < 60_000) return
    busy = true
    busySince = System.currentTimeMillis()
    GarminRemote.note(context, "Voice test: start (mic type in service: ${ReadAloudService.hasMicrophone})")
    GarminRemote.say(context, "Słucham") { record(context) }
  }

  @SuppressLint("MissingPermission")
  private fun record(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return finish(context, null, "Za stary Android")
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      return finish(context, null, "Orka nie ma zgody na mikrofon")
    }
    if (!SpeechRecognizer.isRecognitionAvailable(context)) return finish(context, null, "Brak rozpoznawania mowy")
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val headset = audio.availableCommunicationDevices.firstOrNull {
      it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.type == AudioDeviceInfo.TYPE_BLE_HEADSET
    }
    val routed = headset != null && audio.setCommunicationDevice(headset)
    GarminRemote.note(context, "Voice test: microphone ${if (routed) headset?.productName else "of the phone"}")

    val size = maxOf(AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT), 4096)
    val recorder = try {
      AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size)
    } catch (e: Exception) {
      return finish(context, null, "Mikrofon niedostępny: ${e.message}")
    }
    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      return finish(context, null, "Mikrofon niedostępny")
    }
    record = recorder
    val (source, sink) = ParcelFileDescriptor.createPipe()
    recorder.startRecording()
    pumping = true
    Thread {
      val buffer = ByteArray(size)
      var loudest = 0
      val until = System.currentTimeMillis() + MAX_MS
      ParcelFileDescriptor.AutoCloseOutputStream(sink).use { out ->
        runCatching {
          while (pumping && System.currentTimeMillis() < until) {
            val read = recorder.read(buffer, 0, buffer.size)
            if (read < 0) break
            var i = 0
            while (i + 1 < read) {
              val sample = (buffer[i].toInt() and 0xff) or (buffer[i + 1].toInt() shl 8)
              loudest = maxOf(loudest, kotlin.math.abs(sample.toShort().toInt()))
              i += 2
            }
            if (read > 0) out.write(buffer, 0, read)
          }
        }
      }
      // All zeros means Android silenced the microphone for an app in the background.
      GarminRemote.note(context, "Voice test: loudest sample $loudest")
    }.start()

    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "pl-PL")
      .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, source)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
      .putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, RATE)
    val speech = SpeechRecognizer.createSpeechRecognizer(context)
    recognizer = speech
    // Build 91 heard the recognizer finish with speech and still got no text in the final
    // results, so the last partial result stands in for an empty final one.
    var lastPartial: String? = null
    fun textOf(bundle: Bundle?) = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
      ?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
    speech.setRecognitionListener(object : RecognitionListener {
      override fun onResults(results: Bundle?) {
        val heard = textOf(results)
        GarminRemote.note(context, "Voice test: final '${heard ?: ""}' ${results?.keySet()}, last partial '${lastPartial ?: ""}'")
        finish(context, heard ?: lastPartial, null)
      }

      override fun onPartialResults(partialResults: Bundle?) {
        textOf(partialResults)?.let { lastPartial = it }
      }

      override fun onError(error: Int) {
        GarminRemote.note(context, "Voice test: recognizer error $error, last partial '${lastPartial ?: ""}'")
        val nothingHeard = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
        val partial = lastPartial
        if (partial != null) finish(context, partial, null)
        else finish(context, null, if (nothingHeard) null else "Błąd rozpoznawania $error")
      }

      override fun onEndOfSpeech() {
        pumping = false
      }

      override fun onReadyForSpeech(params: Bundle?) = Unit
      override fun onBeginningOfSpeech() = Unit
      override fun onRmsChanged(rmsdB: Float) = Unit
      override fun onBufferReceived(buffer: ByteArray?) = Unit
      override fun onEvent(eventType: Int, params: Bundle?) = Unit
    })
    speech.startListening(intent)
  }

  private fun finish(context: Context, text: String?, error: String?) {
    main.post {
      if (!busy) return@post
      pumping = false
      runCatching { record?.stop() }
      record?.release()
      record = null
      recognizer?.destroy()
      recognizer = null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).clearCommunicationDevice()
      }
      GarminRemote.note(context, "Voice test: ${text ?: error ?: "nothing heard"}")
      val reply = when {
        text != null -> "Usłyszałem: $text"
        error != null -> error
        else -> "Nic nie usłyszałem"
      }
      // A moment for the headset to leave the call mode before speaking again.
      main.postDelayed({
        GarminRemote.say(context, reply) { busy = false }
      }, 400)
    }
  }
}
