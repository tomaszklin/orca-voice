package expo.modules.orcavoicebackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Orca Voice fork: a foreground service that keeps Orca alive and awake with the screen off, so
 * new agent replies can still be read aloud.
 *
 * Three things stop working once Orca leaves the screen, and this answers each: the process is
 * frozen (a foreground service keeps it at foreground priority), the CPU sleeps (a partial wake
 * lock), and React Native pauses JS timers in the background (the service ticks instead, and the
 * module forwards each tick to JS as an event, which the paused timers do not affect).
 *
 * Its notification carries icon buttons that show without expanding it (owner's requests,
 * 2026-10-21 and 2026-10-28): a speaker that mutes and unmutes auto-read for now — a mute the
 * app's JS owns and forgets on restart — and, while something is being read, Stop.
 * [ReadAloudTileService] offers the same mute in Quick Settings.
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
    val control = when (intent?.action) {
      ACTION_TOGGLE_MUTE -> ReadAloudControls.TOGGLE_MUTE
      ACTION_STOP_READING -> ReadAloudControls.STOP_READING
      else -> null
    }
    if (control != null) {
      // A button on a notification left behind by a service that is gone starts nothing.
      if (!isRunning) {
        stopSelf(startId)
        return START_NOT_STICKY
      }
      ReadAloudControls.send(control)
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
    ReadAloudTileService.refresh(this)
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
    ReadAloudTileService.refresh(this)
    super.onDestroy()
  }

  private fun refreshNotification() {
    if (!isRunning) return
    val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, buildNotification())
  }

  private fun controlIntent(requestCode: Int, action: String): PendingIntent =
    PendingIntent.getService(
      this,
      requestCode,
      Intent(this, ReadAloudService::class.java).setAction(action),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

  private fun buildNotification(): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Reading replies aloud", NotificationManager.IMPORTANCE_LOW)
      )
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this).setPriority(Notification.PRIORITY_LOW)
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val content = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val actions = buildList {
      if (speaking) {
        add(action(R.drawable.orca_voice_stop, "Stop reading", controlIntent(2, ACTION_STOP_READING)))
      }
      add(
        if (isMuted) {
          action(R.drawable.orca_voice_volume_off, "Unmute auto-read", controlIntent(1, ACTION_TOGGLE_MUTE))
        } else {
          action(R.drawable.orca_voice_volume_up, "Mute auto-read", controlIntent(1, ACTION_TOGGLE_MUTE))
        }
      )
    }
    // The monochrome icon expo-notifications generates from app.json, else the launcher icon.
    val smallIcon = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 } ?: applicationInfo.icon
    actions.forEach { builder.addAction(it) }
    // Media style for its icon buttons, shown even while the notification is collapsed. Without a
    // media session Android draws it as an ordinary notification, not as a player in Quick
    // Settings, and the music app keeps the headset and steering-wheel buttons.
    return builder
      .setStyle(Notification.MediaStyle().setShowActionsInCompactView(*IntArray(actions.size) { it }))
      .setContentTitle(title)
      .setContentText(if (isMuted) MUTED_TEXT else text)
      .setSmallIcon(smallIcon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setContentIntent(content)
      .build()
  }

  private fun action(icon: Int, label: String, intent: PendingIntent): Notification.Action =
    Notification.Action.Builder(Icon.createWithResource(this, icon), label, intent).build()

  companion object {
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_TICK_MS = "tickMs"
    const val DEFAULT_TICK_MS = 3000L
    private const val ACTION_TOGGLE_MUTE = "expo.modules.orcavoicebackground.TOGGLE_MUTE"
    private const val ACTION_STOP_READING = "expo.modules.orcavoicebackground.STOP_READING"
    private const val MUTED_TEXT = "Auto-read muted"
    private const val CHANNEL_ID = "orca-voice-read-aloud"
    private const val NOTIFICATION_ID = 7417
    @Volatile var isRunning = false
      private set
    @Volatile var isMuted = false
      private set
    @Volatile private var speaking = false
    private var current: ReadAloudService? = null

    /** Shows the mute JS decided on, here and on the tile; a later start keeps showing it. */
    fun showMuted(next: Boolean) {
      isMuted = next
      Handler(Looper.getMainLooper()).post {
        current?.let {
          it.refreshNotification()
          ReadAloudTileService.refresh(it)
        }
      }
    }

    /** Whether something is being read, which brings Stop into the notification. */
    fun showSpeaking(next: Boolean) {
      if (speaking == next) return
      speaking = next
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

/** The notification's and the tile's buttons, handed to whichever module instance is listening. */
object ReadAloudControls {
  const val TOGGLE_MUTE = "toggleMute"
  const val STOP_READING = "stopReading"

  @Volatile var listener: ((String) -> Unit)? = null

  fun send(control: String) {
    listener?.invoke(control)
  }

  fun toggleMute() = send(TOGGLE_MUTE)
}
