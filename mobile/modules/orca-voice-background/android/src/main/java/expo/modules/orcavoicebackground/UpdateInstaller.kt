package expo.modules.orcavoicebackground

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
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
 * Orca Voice fork: downloads a build from the fork's GitHub releases. JS follows it through
 * [listener] and opens the system installer when the file is ready; a notification shows the same
 * and also opens the installer, for when Orca was left during the download.
 */
object UpdateInstaller {
  const val NOTIFICATION_ID = 7419
  const val EXTRA_URL = "url"
  private const val CHANNEL_ID = "orca-voice-updates"
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
      notify(context, "Update downloaded", "Tap to install", null, installerIntent(context))
      listener?.invoke("done", null, null)
    } else {
      notify(context, "Update failed", failure, null, null)
      listener?.invoke("failed", null, failure)
    }
  }

  /** False when the download is gone or the installer did not start. */
  fun openInstaller(context: Context): Boolean {
    if (!apkFile(context).exists()) return false
    return try {
      context.startActivity(installerIntent(context))
      notificationManager(context).cancel(NOTIFICATION_ID)
      true
    } catch (_: Exception) {
      false
    }
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
