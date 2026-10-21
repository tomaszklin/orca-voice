package expo.modules.orcavoicebackground

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** Hands the downloaded APK to the installer; its own class so it cannot clash with another FileProvider. */
class UpdateFileProvider : FileProvider()

/**
 * Orca Voice fork: downloads a build from the home server and opens the system installer, as the
 * owner's HAL 9000 app does. Progress and the result show in a notification, which also opens the
 * installer when Android will not start it from the background (Orca left during the download).
 */
object UpdateInstaller {
  private const val CHANNEL_ID = "orca-voice-updates"
  private const val NOTIFICATION_ID = 7419
  @Volatile private var running = false

  /** False when a download is already running; the work itself happens on its own thread. */
  fun start(context: Context, url: String): Boolean {
    if (running) return false
    running = true
    val appContext = context.applicationContext
    Thread {
      try {
        install(appContext, url)
      } catch (error: Exception) {
        notify(appContext, "Update failed", error.message ?: "Could not download the update", null, null)
      } finally {
        running = false
      }
    }.start()
    return true
  }

  private fun install(context: Context, url: String) {
    val dir = File(context.cacheDir, "updates").apply { mkdirs() }
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "orca-voice-update.apk")
    download(context, url, file)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.orcavoice.updates", file)
    val installer = Intent(Intent.ACTION_VIEW)
      .setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    notify(context, "Update downloaded", "Tap to install", null, installer)
    context.startActivity(installer)
  }

  private fun download(context: Context, url: String, file: File) {
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 15_000
    connection.readTimeout = 30_000
    try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK) {
        throw IOException("HTTP ${connection.responseCode}")
      }
      val total = connection.contentLengthLong
      var done = 0L
      var shown = -1
      connection.inputStream.use { input ->
        file.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            done += read
            val percent = if (total > 0) (done * 100 / total).toInt() else 0
            if (percent / 5 != shown / 5) {
              shown = percent
              notify(context, "Downloading update", "$percent%", percent, null)
            }
          }
        }
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun notify(context: Context, title: String, text: String, percent: Int?, open: Intent?) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
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
