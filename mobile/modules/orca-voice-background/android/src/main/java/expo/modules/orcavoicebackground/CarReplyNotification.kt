package expo.modules.orcavoicebackground

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput

/**
 * Orca Voice fork: a reply by voice from Android Auto. A sideloaded app's car screen is a media
 * player with no way to type, but Android Auto answers a message with the driver's dictation, so a
 * session's Reply posts one; what comes back goes to JS as `onCarReply`.
 */
object CarReplyNotification {
  private const val CHANNEL_ID = "orca_voice_car_replies"
  private const val REPLY_KEY = "orca_voice_car_reply"
  const val ACTION_REPLY = "expo.modules.orcavoicebackground.CAR_REPLY"
  const val ACTION_DONE = "expo.modules.orcavoicebackground.CAR_REPLY_DONE"
  const val EXTRA_PANE = "paneKey"
  const val EXTRA_PROJECT = "project"
  // Main thread only.
  private val ids = mutableMapOf<String, Int>()
  private var nextId = 7400

  /**
   * `problem`: why the last reply was not sent, added under the prompt. `fresh`: the project of a chat
   * the car just started, which the session list does not have yet.
   */
  fun post(context: Context, paneKey: String, problem: String? = null, fresh: String? = null) {
    val session = CarData.session(paneKey)
    val title = session?.title ?: CarWords.newSession
    val project = session?.project ?: fresh ?: return
    ensureChannel(context)
    val id = ids.getOrPut(paneKey) { nextId++ }
    val agent = Person.Builder().setName(title).setKey(paneKey).setBot(true).build()
    val prompt = if (session == null) CarWords.firstMessagePrompt else CarWords.replyPrompt
    val style = NotificationCompat.MessagingStyle(Person.Builder().setName(CarWords.you).setKey("me").build())
      .setConversationTitle("$project · $title")
      .addMessage(prompt, System.currentTimeMillis(), agent)
    problem?.let { style.addMessage(it, System.currentTimeMillis(), agent) }

    // Mutable: Android puts the dictated text into it.
    val replyIntent = PendingIntent.getBroadcast(
      context,
      id * 2,
      Intent(context, CarReplyReceiver::class.java).setAction(ACTION_REPLY).putExtra(EXTRA_PANE, paneKey)
        .putExtra(EXTRA_PROJECT, project),
      PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
    )
    val doneIntent = PendingIntent.getBroadcast(
      context,
      id * 2 + 1,
      Intent(context, CarReplyReceiver::class.java).setAction(ACTION_DONE).putExtra(EXTRA_PANE, paneKey),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    // Android Auto shows a message only with a reply action like this and an invisible mark-as-read.
    val reply = NotificationCompat.Action.Builder(0, CarWords.reply, replyIntent)
      .addRemoteInput(RemoteInput.Builder(REPLY_KEY).setLabel(CarWords.reply).build())
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
      .setShowsUserInterface(false)
      .build()
    val markRead = NotificationCompat.Action.Builder(0, CarWords.done, doneIntent)
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
      .setShowsUserInterface(false)
      .build()
    val smallIcon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      .takeIf { it != 0 } ?: context.applicationInfo.icon
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setStyle(style)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .addAction(reply)
      .addInvisibleAction(markRead)
      .setAutoCancel(true)
      .build()
    runCatching { NotificationManagerCompat.from(context).notify(id, notification) }
  }

  fun cancel(context: Context, paneKey: String) {
    ids[paneKey]?.let { NotificationManagerCompat.from(context).cancel(it) }
  }

  fun replyText(intent: Intent): String? =
    RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY_KEY)?.toString()?.trim()?.takeIf { it.isNotEmpty() }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, CarWords.replyChannel, NotificationManager.IMPORTANCE_HIGH))
    }
  }
}

/** The dictated reply, and the car's mark-as-read. */
class CarReplyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val paneKey = intent.getStringExtra(CarReplyNotification.EXTRA_PANE) ?: return
    val app = context.applicationContext
    when (intent.action) {
      CarReplyNotification.ACTION_REPLY -> {
        val text = CarReplyNotification.replyText(intent) ?: return
        CarData.reply(paneKey, text) { ok, message ->
          if (ok) CarReplyNotification.cancel(app, paneKey)
          else CarReplyNotification.post(app, paneKey, message, intent.getStringExtra(CarReplyNotification.EXTRA_PROJECT))
        }
      }
      CarReplyNotification.ACTION_DONE -> CarReplyNotification.cancel(app, paneKey)
    }
  }
}
