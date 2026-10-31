package expo.modules.orcavoicebackground

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Hands the downloaded APK to the installer; its own class so it cannot clash with another FileProvider. */
class UpdateFileProvider : FileProvider()

/**
 * Orca Voice fork: downloads a build from the fork's GitHub releases. JS follows it through
 * [listener] and opens the system installer when the file is ready; a notification shows the same
 * and also opens the installer, for when Orca was left during the download.
 */
object UpdateInstaller {
  private const val CHANNEL_ID = "orca-voice-updates"
  private const val NOTIFICATION_ID = 7419
  @Volatile private var running = false

  /** Called with `progress` and a percent, then with `done`, or `failed` and a message. */
  @Volatile var listener: ((event: String, percent: Int?, message: String?) -> Unit)? = null

  /** False when a download is already running; the work itself happens on its own thread. */
  fun start(context: Context, url: String): Boolean {
    if (running) return false
    running = true
    val appContext = context.applicationContext
    Thread {
      try {
        download(appContext, url)
        notify(appContext, "Update downloaded", "Tap to install", null, installerIntent(appContext))
        listener?.invoke("done", null, null)
      } catch (error: Exception) {
        val message = error.message ?: "Could not download the update"
        notify(appContext, "Update failed", message, null, null)
        listener?.invoke("failed", null, message)
      } finally {
        running = false
      }
    }.start()
    return true
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
    notify(context, "Downloading update", "0%", 0, null)
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
                notify(context, "Downloading update", "$percent%", percent, null)
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

  private fun notify(context: Context, title: String, text: String, percent: Int?, open: Intent?) {
    val manager = notificationManager(context)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
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
    manager.notify(NOTIFICATION_ID, builder.build())
  }
}
