package expo.modules.orcavoicebackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Hands the downloaded APK to the installer; its own class so it cannot clash with another FileProvider. */
class UpdateFileProvider : FileProvider()

/**
 * Why a service: Android cuts the network of an app that left the screen, which ended downloads
 * with "connection abort" (seen on Android 16). The wake lock covers a phone put in a pocket.
 */
class UpdateDownloadService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = UpdateInstaller.progressNotification(this, 0)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(UpdateInstaller.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(UpdateInstaller.NOTIFICATION_ID, notification)
    }
    val url = intent?.getStringExtra(UpdateInstaller.EXTRA_URL).orEmpty()
    Thread {
      val power = getSystemService(POWER_SERVICE) as PowerManager
      val wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OrcaVoice:update")
      wakeLock.acquire(WAKE_LOCK_TIMEOUT_MS)
      try {
        UpdateInstaller.run(this, url) {
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
        }
      } finally {
        if (wakeLock.isHeld) wakeLock.release()
      }
    }.start()
    return START_NOT_STICKY
  }

  private companion object {
    const val WAKE_LOCK_TIMEOUT_MS = 15 * 60 * 1000L
  }
}

/**
 * Gets the result of a session install. Android asks the user only when it cannot update silently
 * (when another store owns Orca's updates, say); then this opens its confirmation.
 */
class UpdateInstallReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
      PackageInstaller.STATUS_PENDING_USER_ACTION -> {
        @Suppress("DEPRECATION")
        val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
        try {
          context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
          UpdateInstaller.installFailed(context, "Couldn't open the installer")
        }
      }
      PackageInstaller.STATUS_SUCCESS -> {}
      // The user said no; the overlay keeps "Install" for another try.
      PackageInstaller.STATUS_FAILURE_ABORTED -> UpdateInstaller.clearRelaunch(context)
      else -> UpdateInstaller.installFailed(
        context,
        intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Couldn't install the update"
      )
    }
  }
}

/**
 * Runs in the new build after Orca updated itself: the update ends the old process, so this brings
 * Orca back. Android may block opening it from here, so the notification does the same on a tap.
 */
class UpdateReplacedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (!UpdateInstaller.takeRelaunch(context)) return
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    UpdateInstaller.notifyUpdated(context, launch)
    try {
      context.startActivity(launch)
    } catch (_: Exception) {}
  }
}

/**
 * Orca Voice fork: downloads a build from the fork's GitHub releases. JS follows it through
 * [listener] and opens the system installer when the file is ready; a notification shows the same
 * and also opens the installer, for when Orca was left during the download.
 */
object UpdateInstaller {
  const val NOTIFICATION_ID = 7419
  const val EXTRA_URL = "url"
  private const val CHANNEL_ID = "orca-voice-updates"
  private const val RELAUNCH_MARKER = "relaunch"
  @Volatile private var running = false

  /** Called with `progress` and a percent, then with `done`, or `failed` and a message. */
  @Volatile var listener: ((event: String, percent: Int?, message: String?) -> Unit)? = null

  /** False when a download is already running, or Android refused the service in the background. */
  fun start(context: Context, url: String): Boolean {
    if (running) return false
    running = true
    return try {
      val service = Intent(context, UpdateDownloadService::class.java).putExtra(EXTRA_URL, url)
      ContextCompat.startForegroundService(context, service)
      true
    } catch (_: Exception) {
      running = false
      false
    }
  }

  /** On the service's thread; `leaveForeground` ends the service before the last notification. */
  fun run(context: Context, url: String, leaveForeground: () -> Unit) {
    val failure = try {
      download(context, url)
      null
    } catch (error: Exception) {
      error.message ?: "Could not download the update"
    }
    leaveForeground()
    running = false
    if (failure == null) {
      notify(context, "Update downloaded", "Tap to install", null, unknownAutoIntent(context) ?: installerIntent(context))
      listener?.invoke("done", null, null)
    } else {
      notify(context, "Update failed", failure, null, null)
      listener?.invoke("failed", null, failure)
    }
  }

  /**
   * False when the download is gone or the installer did not start. Android 12+ lets an app update
   * itself without asking, which skips the installer's screens; older phones get the installer.
   */
  fun openInstaller(context: Context): Boolean {
    if (!apkFile(context).exists()) return false
    unknownAutoIntent(context)?.let { intent ->
      return try {
        context.startActivity(intent)
        notificationManager(context).cancel(NOTIFICATION_ID)
        true
      } catch (_: Exception) {
        false
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      notificationManager(context).cancel(NOTIFICATION_ID)
      // Why a thread: copying 60 MB into the session would hold up JS for a second or more.
      Thread { installInSession(context.applicationContext) }.start()
      return true
    }
    return try {
      context.startActivity(installerIntent(context))
      notificationManager(context).cancel(NOTIFICATION_ID)
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun installInSession(context: Context) {
    val installer = context.packageManager.packageInstaller
    var sessionId = -1
    try {
      val apk = apkFile(context)
      val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
      params.setAppPackageName(context.packageName)
      params.setSize(apk.length())
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
      }
      sessionId = installer.createSession(params)
      installer.openSession(sessionId).use { session ->
        apk.inputStream().use { input ->
          session.openWrite("orca-voice.apk", 0, apk.length()).use { output ->
            input.copyTo(output, 64 * 1024)
            session.fsync(output)
          }
        }
        File(updatesDir(context), RELAUNCH_MARKER).createNewFile()
        val result = Intent(context, UpdateInstallReceiver::class.java)
        // Mutable: the installer adds the status to this intent.
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        session.commit(PendingIntent.getBroadcast(context, 3, result, flags).intentSender)
      }
    } catch (error: Exception) {
      if (sessionId != -1) {
        try {
          installer.abandonSession(sessionId)
        } catch (_: Exception) {}
      }
      installFailed(context, error.message ?: "Couldn't install the update")
    }
  }

  fun installFailed(context: Context, message: String) {
    clearRelaunch(context)
    notify(context, "Update failed", message, null, null)
    listener?.invoke("installFailed", null, message)
  }

  /** True once after an update this installer started; also drops the installed APK. */
  fun takeRelaunch(context: Context): Boolean {
    val due = File(updatesDir(context), RELAUNCH_MARKER).exists()
    updatesDir(context).listFiles()?.forEach { it.delete() }
    return due
  }

  fun clearRelaunch(context: Context) {
    File(updatesDir(context), RELAUNCH_MARKER).delete()
  }

  fun notifyUpdated(context: Context, launch: Intent) {
    notify(context, "Orca updated", "Tap to open", null, launch)
  }

  /** Orca running again makes the "Orca updated" notification old news. */
  fun dismissUpdated(context: Context) {
    if (!running) notificationManager(context).cancel(NOTIFICATION_ID)
  }

  /** Android 8+ opens the installer for an app only after the user allowed that app once. */
  fun canInstall(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.packageManager.canRequestPackageInstalls()

  /** The system screen with Orca's "Install unknown apps" switch. */
  fun openInstallPermission(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
    val screen = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return try {
      context.startActivity(screen)
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun updatesDir(context: Context) = File(context.cacheDir, "updates")

  private fun apkFile(context: Context) = File(updatesDir(context), "orca-voice-update.apk")

  /**
   * Orca installed through UnknownAuto keeps Google Play as its installer of record, which Android
   * Auto needs to show Orca's own car screens; an update through our session would make Orca the
   * installer and hide them again, so updates go back through UnknownAuto when it is there.
   */
  private fun unknownAutoIntent(context: Context): Intent? {
    val intent = installerIntent(context).setPackage(UNKNOWN_AUTO)
    return intent.takeIf { it.resolveActivity(context.packageManager) != null }
  }

  private const val UNKNOWN_AUTO = "com.mag.unknownauto"

  private fun installerIntent(context: Context): Intent {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.orcavoice.updates", apkFile(context))
    return Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
  }

  private fun download(context: Context, url: String) {
    val dir = updatesDir(context).apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }
    val partial = File(dir, "orca-voice-update.part")
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 15_000
    connection.readTimeout = 30_000
    try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK) {
        throw IOException("HTTP ${connection.responseCode}")
      }
      val total = connection.contentLengthLong
      var done = 0L
      var shown = 0
      connection.inputStream.use { input ->
        partial.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            done += read
            val percent = if (total > 0) (done * 100 / total).toInt() else 0
            if (percent != shown) {
              if (percent / 5 != shown / 5) {
                notificationManager(context).notify(NOTIFICATION_ID, progressNotification(context, percent))
              }
              shown = percent
              listener?.invoke("progress", percent, null)
            }
          }
        }
      }
      // Why: a dropped connection can end the stream quietly, and the installer calls a cut APK corrupt.
      if (total > 0 && done != total) {
        throw IOException("The download ended early")
      }
    } finally {
      connection.disconnect()
    }
    if (!partial.renameTo(apkFile(context))) {
      throw IOException("Could not save the update")
    }
  }

  private fun notificationManager(context: Context) =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  fun progressNotification(context: Context, percent: Int): Notification =
    notification(context, "Downloading update", "$percent%", percent, null)

  private fun notify(context: Context, title: String, text: String, percent: Int?, open: Intent?) {
    notificationManager(context).notify(NOTIFICATION_ID, notification(context, title, text, percent, open))
  }

  private fun notification(context: Context, title: String, text: String, percent: Int?, open: Intent?): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      notificationManager(context).createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "App updates", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val smallIcon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      .takeIf { it != 0 } ?: context.applicationInfo.icon
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(smallIcon)
      .setSilent(true)
      .setOngoing(percent != null)
      .setAutoCancel(percent == null)
    if (percent != null) {
      builder.setProgress(100, percent, false)
    }
    if (open != null) {
      builder.setContentIntent(PendingIntent.getActivity(context, 2, open, PendingIntent.FLAG_IMMUTABLE))
    }
    return builder.build()
  }
}
