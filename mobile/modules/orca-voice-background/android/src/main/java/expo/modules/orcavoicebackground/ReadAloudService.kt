package expo.modules.orcavoicebackground

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat

/**
 * Orca Voice fork: a foreground service that keeps Orca alive and awake with the screen off, so
 * new agent replies can still be read aloud.
 *
 * Three things stop working once Orca leaves the screen, and this answers each: the process is
 * frozen (a foreground service keeps it at foreground priority), the CPU sleeps (a partial wake
 * lock), and React Native pauses JS timers in the background (the service ticks instead, and the
 * module forwards each tick to JS as an event, which the paused timers do not affect).
 *
 * Its notification carries a Mute / Unmute button: a temporary mute of auto-read that the app's
 * JS owns and forgets on restart (owner's request, 2026-10-21).
 */
class ReadAloudService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private val handler = Handler(Looper.getMainLooper())
  private var tickIntervalMs = DEFAULT_TICK_MS
  private var title = "Orca"
  private var text = "Reading replies aloud"
  private val tick = object : Runnable {
    override fun run() {
      ReadAloudTicker.tick()
      handler.postDelayed(this, tickIntervalMs)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    current = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_TOGGLE_MUTE) {
      // A button on a notification left behind by a service that is gone starts nothing.
      if (!isRunning) {
        stopSelf(startId)
        return START_NOT_STICKY
      }
      ReadAloudControls.toggleMute()
      return START_STICKY
    }
    // A sticky restart (null intent) after the system killed only the service is worth keeping:
    // the app's JS is still listening. After the whole process died there is no JS to tick, and
    // the service would only hold a wake lock, so it ends itself.
    if (intent == null && ReadAloudTicker.listener == null) {
      stopSelf()
      return START_NOT_STICKY
    }
    title = intent?.getStringExtra(EXTRA_TITLE) ?: title
    text = intent?.getStringExtra(EXTRA_TEXT) ?: text
    tickIntervalMs = intent?.getLongExtra(EXTRA_TICK_MS, DEFAULT_TICK_MS) ?: DEFAULT_TICK_MS
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    if (wakeLock == null) {
      val power = getSystemService(POWER_SERVICE) as PowerManager
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OrcaVoice:read-aloud").apply {
        setReferenceCounted(false)
        acquire()
      }
    }
    handler.removeCallbacks(tick)
    handler.post(tick)
    isRunning = true
    return START_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiping Orca away is the user ending it; the reading goes with it.
    stopSelf()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    if (current === this) current = null
    handler.removeCallbacks(tick)
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    isRunning = false
    super.onDestroy()
  }

  private fun refreshNotification() {
    if (!isRunning) return
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, buildNotification())
  }

  private fun buildNotification(): android.app.Notification {
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Reading replies aloud", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val content = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val toggle = PendingIntent.getService(
      this,
      1,
      Intent(this, ReadAloudService::class.java).setAction(ACTION_TOGGLE_MUTE),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    // The monochrome icon expo-notifications generates from app.json, else the launcher icon.
    val smallIcon = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 } ?: applicationInfo.icon
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(if (muted) MUTED_TEXT else text)
      .setSmallIcon(smallIcon)
      .addAction(
        if (muted) android.R.drawable.ic_lock_silent_mode_off else android.R.drawable.ic_lock_silent_mode,
        if (muted) "Unmute" else "Mute",
        toggle
      )
      .setOngoing(true)
      .setSilent(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(content)
      .build()
  }

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_TICK_MS = "tickMs"
    const val DEFAULT_TICK_MS = 3000L
    private const val ACTION_TOGGLE_MUTE = "expo.modules.orcavoicebackground.TOGGLE_MUTE"
    private const val MUTED_TEXT = "Auto-read muted until you unmute or restart Orca"
    private const val CHANNEL_ID = "orca-voice-read-aloud"
    private const val NOTIFICATION_ID = 7417
    @Volatile var isRunning = false
      private set
    @Volatile private var muted = false
    private var current: ReadAloudService? = null

    /** Shows the mute JS decided on; a later start keeps showing it. */
    fun showMuted(next: Boolean) {
      muted = next
      Handler(Looper.getMainLooper()).post { current?.refreshNotification() }
    }
  }
}

/** The service's ticks, handed to whichever module instance is listening. */
object ReadAloudTicker {
  @Volatile var listener: (() -> Unit)? = null

  fun tick() {
    listener?.invoke()
  }
}

/** The notification's Mute button, handed to whichever module instance is listening. */
object ReadAloudControls {
  @Volatile var listener: (() -> Unit)? = null

  fun toggleMute() {
    listener?.invoke()
  }
}
