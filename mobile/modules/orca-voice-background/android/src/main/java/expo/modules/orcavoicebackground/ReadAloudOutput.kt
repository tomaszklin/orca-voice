package expo.modules.orcavoicebackground

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat

/**
 * Orca Voice fork: whether sound goes somewhere only the owner hears — headphones, a car — rather
 * than the phone's own speaker, for the option that keeps auto-read to those (2026-10-28).
 * Reports through [ReadAloudSpeech.listener]: "noisy" when Android is about to move audio to the
 * speaker (headphones unplugged, Bluetooth gone), "private-output" when such a device arrives.
 */
internal object ReadAloudOutput {
  // A Bluetooth speaker counts too: there is no telling it from a car or headphones.
  private val PRIVATE_TYPES = setOf(
    AudioDeviceInfo.TYPE_WIRED_HEADSET,
    AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
    AudioDeviceInfo.TYPE_LINE_ANALOG,
    AudioDeviceInfo.TYPE_LINE_DIGITAL,
    AudioDeviceInfo.TYPE_AUX_LINE,
    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
    AudioDeviceInfo.TYPE_USB_DEVICE,
    AudioDeviceInfo.TYPE_USB_ACCESSORY,
    AudioDeviceInfo.TYPE_USB_HEADSET,
    AudioDeviceInfo.TYPE_HEARING_AID,
    AudioDeviceInfo.TYPE_BUS,
    AudioDeviceInfo.TYPE_BLE_HEADSET,
    AudioDeviceInfo.TYPE_BLE_SPEAKER,
    AudioDeviceInfo.TYPE_BLE_BROADCAST
  )

  private var watching: Context? = null

  private val noisy = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
        ReadAloudSpeech.listener?.invoke("noisy", "", null)
      }
    }
  }

  private val devices = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) {
      if (added.any { it.type in PRIVATE_TYPES }) {
        ReadAloudSpeech.listener?.invoke("private-output", "", null)
      }
    }
  }

  fun isPrivate(context: Context): Boolean {
    val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    return manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { it.type in PRIVATE_TYPES }
  }

  @Synchronized
  fun watch(context: Context) {
    if (watching != null) return
    val app = context.applicationContext
    ContextCompat.registerReceiver(
      app,
      noisy,
      IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
      ContextCompat.RECEIVER_NOT_EXPORTED
    )
    val manager = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    manager.registerAudioDeviceCallback(devices, Handler(Looper.getMainLooper()))
    watching = app
  }

  @Synchronized
  fun unwatch() {
    val app = watching ?: return
    runCatching { app.unregisterReceiver(noisy) }
    (app.getSystemService(Context.AUDIO_SERVICE) as AudioManager).unregisterAudioDeviceCallback(devices)
    watching = null
  }
}
