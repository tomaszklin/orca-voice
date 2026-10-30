package expo.modules.orcavoicebackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.content.ContextCompat

/**
 * Orca Voice fork: a foreground service that keeps Orca alive and awake with the screen off, so
 * new agent replies can still be read aloud.
 *
 * Three things stop working once Orca leaves the screen, and this answers each: the process is
 * frozen (a foreground service keeps it at foreground priority), the CPU sleeps (a partial wake
 * lock), and React Native pauses JS timers in the background (the service ticks instead, and the
 * module forwards each tick to JS as an event, which the paused timers do not affect).
 *
 * Its notification carries five icon buttons that never move (owner's requests, 2026-10-21 to
 * 2026-10-29): Previous, Play or Pause and Next, which show without expanding it, then Stop and
 * one that pauses and resumes auto-read — a pause the app's JS owns and forgets on restart. While
 * auto-read is paused, the collapsed notification shows only that one. [ReadAloudMediaSession]
 * offers the reading buttons to headsets.
 */
class ReadAloudService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private val handler = Handler(Looper.getMainLooper())
  private var tickIntervalMs = DEFAULT_TICK_MS
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
    val control = intent?.action?.let { CONTROLS[it] }
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
    tickIntervalMs = intent?.getLongExtra(EXTRA_TICK_MS, DEFAULT_TICK_MS) ?: DEFAULT_TICK_MS
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    if (intent != null && stopRequestedWhileStarting()) {
      stopSelf()
      return START_NOT_STICKY
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
    // Why: a refresh that ran after Android dropped the foreground notification posted it again as
    // a plain ongoing one, which then stayed with the service gone.
    (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTIFICATION_ID)
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
    val active = readerState != "idle"
    // Always the same five buttons in the same places, like a music player: one that cannot do
    // anything now is dimmed and inert rather than left out.
    val actions = listOf(
      if (canPrevious) {
        action(R.drawable.orca_voice_previous, "Previous message", controlIntent(3, ACTION_PREVIOUS))
      } else {
        action(R.drawable.orca_voice_previous_off, "No earlier message", null)
      },
      when {
        readerState == "reading" -> action(R.drawable.orca_voice_pause, "Pause", controlIntent(4, ACTION_PAUSE))
        // With nothing being read, Play reads the last message again.
        active || canRepeat -> action(R.drawable.orca_voice_play, "Play", controlIntent(5, ACTION_PLAY))
        else -> action(R.drawable.orca_voice_play_off, "Nothing to read", null)
      },
      if (canNext) {
        action(R.drawable.orca_voice_next, "Next message", controlIntent(6, ACTION_NEXT))
      } else {
        action(R.drawable.orca_voice_next_off, "No message waiting", null)
      },
      if (active) {
        action(R.drawable.orca_voice_stop, "Stop reading", controlIntent(2, ACTION_STOP_READING))
      } else {
        action(R.drawable.orca_voice_stop_off, "Nothing to stop", null)
      },
      if (autoReadPaused) {
        action(R.drawable.orca_voice_auto_read_off, "Resume auto-read", controlIntent(1, ACTION_TOGGLE_AUTO_READ))
      } else {
        action(R.drawable.orca_voice_auto_read, "Pause auto-read", controlIntent(1, ACTION_TOGGLE_AUTO_READ))
      }
    )
    // The monochrome icon expo-notifications generates from app.json, else the launcher icon.
    val smallIcon = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 } ?: applicationInfo.icon
    actions.forEach { builder.addAction(it) }
    // Media style for its icon buttons, shown even while the notification is collapsed. Without a
    // media session Android draws it as an ordinary notification, not as a player in Quick
    // Settings, and the music app keeps the headset and steering-wheel buttons.
    val compact = if (autoReadPaused) intArrayOf(4) else intArrayOf(0, 1, 2)
    // One line while nothing is read: the reader's status joins it only when there is one.
    return builder
      .setStyle(Notification.MediaStyle().setShowActionsInCompactView(*compact))
      .setContentTitle(if (autoReadPaused) PAUSED_TITLE else ACTIVE_TITLE)
      .setContentText(readerStatus)
      .setSmallIcon(smallIcon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setContentIntent(content)
      .build()
  }

  private fun action(icon: Int, label: String, intent: PendingIntent?): Notification.Action =
    Notification.Action.Builder(Icon.createWithResource(this, icon), label, intent).build()

  companion object {
    const val EXTRA_TICK_MS = "tickMs"
    const val DEFAULT_TICK_MS = 3000L
    private const val ACTION_TOGGLE_AUTO_READ = "expo.modules.orcavoicebackground.TOGGLE_AUTO_READ"
    private const val ACTION_STOP_READING = "expo.modules.orcavoicebackground.STOP_READING"
    private const val ACTION_PREVIOUS = "expo.modules.orcavoicebackground.PREVIOUS"
    private const val ACTION_PAUSE = "expo.modules.orcavoicebackground.PAUSE"
    private const val ACTION_PLAY = "expo.modules.orcavoicebackground.PLAY"
    private const val ACTION_NEXT = "expo.modules.orcavoicebackground.NEXT"
    private val CONTROLS = mapOf(
      ACTION_TOGGLE_AUTO_READ to ReadAloudControls.TOGGLE_AUTO_READ,
      ACTION_STOP_READING to ReadAloudControls.STOP_READING,
      ACTION_PREVIOUS to ReadAloudControls.PREVIOUS,
      ACTION_PAUSE to ReadAloudControls.PAUSE,
      ACTION_PLAY to ReadAloudControls.PLAY,
      ACTION_NEXT to ReadAloudControls.NEXT
    )
    private const val ACTIVE_TITLE = "Auto-read active"
    private const val PAUSED_TITLE = "Auto-read paused"
    private const val CHANNEL_ID = "orca-voice-read-aloud"
    private const val NOTIFICATION_ID = 7417
    @Volatile var isRunning = false
      private set
    @Volatile var autoReadPaused = false
      private set
    @Volatile private var readerState = "idle"
    @Volatile private var readerStatus: String? = null
    @Volatile private var canRepeat = false
    @Volatile private var canPrevious = false
    @Volatile private var canNext = false
    private var current: ReadAloudService? = null
    // Stopping before onStartCommand's startForeground crashes the app, so such a stop waits for it.
    private val startLock = Any()
    private var pendingStarts = 0
    private var stopWhenStarted = false

    /** False when Android refused the service, e.g. a start attempted from the background. */
    fun start(context: Context, tickMs: Long): Boolean {
      val intent = Intent(context, ReadAloudService::class.java).putExtra(EXTRA_TICK_MS, tickMs)
      return synchronized(startLock) {
        try {
          ContextCompat.startForegroundService(context, intent)
          pendingStarts += 1
          stopWhenStarted = false
          true
        } catch (_: Exception) {
          false
        }
      }
    }

    fun stop(context: Context): Boolean = synchronized(startLock) {
      if (pendingStarts > 0) {
        stopWhenStarted = true
        true
      } else {
        // Refreshes still queued for the main thread must not post the notification again.
        isRunning = false
        context.stopService(Intent(context, ReadAloudService::class.java))
      }
    }

    private fun stopRequestedWhileStarting(): Boolean = synchronized(startLock) {
      if (pendingStarts > 0) pendingStarts -= 1
      val stop = stopWhenStarted && pendingStarts == 0
      if (stop) stopWhenStarted = false
      stop
    }

    /** Shows the auto-read pause JS decided on; a later start keeps it. */
    fun showAutoReadPaused(next: Boolean) {
      autoReadPaused = next
      Handler(Looper.getMainLooper()).post { current?.refreshNotification() }
    }

    /** The reader's state ("idle", "reading", "paused"), which picks the buttons and the text. */
    fun showReader(state: String, status: String?, repeatable: Boolean, previous: Boolean, next: Boolean) {
      if (
        readerState == state && readerStatus == status && canRepeat == repeatable &&
        canPrevious == previous && canNext == next
      ) return
      readerState = state
      readerStatus = status
      canRepeat = repeatable
      canPrevious = previous
      canNext = next
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

/** Notification and headset buttons for whichever module instance listens; values go to JS. */
object ReadAloudControls {
  const val TOGGLE_AUTO_READ = "toggleAutoRead"
  const val STOP_READING = "stop"
  const val PREVIOUS = "previous"
  const val PAUSE = "pause"
  const val PLAY = "play"
  const val NEXT = "next"

  @Volatile var listener: ((String) -> Unit)? = null

  fun send(control: String) {
    listener?.invoke(control)
  }
}
