package expo.modules.orcavoicebackground

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.car.app.connection.CarConnection
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.lifecycle.Observer

/**
 * Orca Voice fork: agent replies as messaging notifications, which Android Auto reads aloud and
 * answers by voice. One conversation per agent pane; a spoken reply goes to JS as
 * `onCarReply`, which types it into that agent's terminal.
 *
 * Android Auto shows a notification as a message only with MessagingStyle, a reply action with a
 * RemoteInput and the reply semantic action, and an invisible mark-as-read action. The app also
 * declares `notification` in `automotive_app_desc.xml`.
 */
object CarMessaging {
  private const val CHANNEL_ID = "orca_voice_car_messages"
  private const val REPLY_KEY = "orca_voice_car_reply"
  const val ACTION_REPLY = "expo.modules.orcavoicebackground.CAR_REPLY"
  const val ACTION_READ = "expo.modules.orcavoicebackground.CAR_READ"
  const val EXTRA_CONVERSATION = "conversation"
  // Enough for Android Auto to give context; older lines are dropped.
  private const val HISTORY = 6

  private data class Line(val text: String, val fromUser: Boolean, val at: Long)

  private class Conversation(val id: Int, var title: String, val lines: MutableList<Line>)

  private val conversations = mutableMapOf<String, Conversation>()
  private var nextId = 7300

  /** JS listeners; replies that come while JS is gone wait in [pendingReplies]. */
  var replyListener: ((conversation: String, text: String) -> Unit)? = null
    set(value) {
      field = value
      if (value != null) {
        val waiting = synchronized(pendingReplies) {
          pendingReplies.toList().also { pendingReplies.clear() }
        }
        waiting.forEach { (conversation, text) -> value(conversation, text) }
      }
    }
  var connectionListener: ((connected: Boolean) -> Unit)? = null
  private val pendingReplies = mutableListOf<Pair<String, String>>()

  @Volatile
  var connected = false
    private set
  private var carConnection: CarConnection? = null
  private val connectionObserver = Observer<Int> { type ->
    val now = type != null && type != CarConnection.CONNECTION_TYPE_NOT_CONNECTED
    if (now != connected) {
      connected = now
      connectionListener?.invoke(now)
    }
  }

  /** Starts following whether the phone is connected to Android Auto. Main thread only. */
  fun watch(context: Context) {
    if (carConnection != null) {
      return
    }
    Handler(Looper.getMainLooper()).post {
      if (carConnection == null) {
        val connection = CarConnection(context.applicationContext)
        carConnection = connection
        connection.type.observeForever(connectionObserver)
      }
    }
  }

  fun unwatch() {
    val connection = carConnection ?: return
    carConnection = null
    Handler(Looper.getMainLooper()).post { connection.type.removeObserver(connectionObserver) }
  }

  @Synchronized
  fun post(context: Context, conversation: String, title: String, text: String) {
    val entry = conversations.getOrPut(conversation) {
      Conversation(nextId++, title, mutableListOf())
    }
    entry.title = title
    entry.lines.add(Line(text, false, System.currentTimeMillis()))
    show(context, conversation, entry, alert = true)
  }

  /** The user's own reply, so the conversation shows it and Android Auto stops waiting. */
  @Synchronized
  fun addUserLine(context: Context, conversation: String, text: String) {
    val entry = conversations[conversation] ?: return
    entry.lines.add(Line(text, true, System.currentTimeMillis()))
    show(context, conversation, entry, alert = false)
  }

  @Synchronized
  fun markRead(context: Context, conversation: String) {
    val entry = conversations.remove(conversation) ?: return
    NotificationManagerCompat.from(context).cancel(entry.id)
  }

  @Synchronized
  fun clear(context: Context) {
    val manager = NotificationManagerCompat.from(context)
    conversations.values.forEach { manager.cancel(it.id) }
    conversations.clear()
  }

  fun deliverReply(context: Context, conversation: String, text: String) {
    addUserLine(context, conversation, text)
    val listener = replyListener
    if (listener != null) {
      listener(conversation, text)
    } else {
      synchronized(pendingReplies) { pendingReplies.add(conversation to text) }
    }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Agent messages (Android Auto)", NotificationManager.IMPORTANCE_HIGH)
      )
    }
  }

  private fun show(context: Context, conversation: String, entry: Conversation, alert: Boolean) {
    ensureChannel(context)
    while (entry.lines.size > HISTORY) {
      entry.lines.removeAt(0)
    }
    val me = Person.Builder().setName("You").setKey("me").build()
    val agent = Person.Builder().setName(entry.title).setKey(conversation).setBot(true).build()
    val style = NotificationCompat.MessagingStyle(me)
    entry.lines.forEach { line ->
      style.addMessage(line.text, line.at, if (line.fromUser) null else agent)
    }

    val replyIntent = PendingIntent.getBroadcast(
      context,
      entry.id * 2,
      Intent(context, CarMessageReceiver::class.java)
        .setAction(ACTION_REPLY)
        .putExtra(EXTRA_CONVERSATION, conversation),
      // Mutable: Android fills the RemoteInput's text into it.
      PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
    )
    val reply = NotificationCompat.Action.Builder(0, "Reply", replyIntent)
      .addRemoteInput(RemoteInput.Builder(REPLY_KEY).setLabel("Reply").build())
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
      .setShowsUserInterface(false)
      .build()

    val readIntent = PendingIntent.getBroadcast(
      context,
      entry.id * 2 + 1,
      Intent(context, CarMessageReceiver::class.java)
        .setAction(ACTION_READ)
        .putExtra(EXTRA_CONVERSATION, conversation),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val markRead = NotificationCompat.Action.Builder(0, "Mark as read", readIntent)
      .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ)
      .setShowsUserInterface(false)
      .build()

    val smallIcon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
      .takeIf { it != 0 } ?: context.applicationInfo.icon
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
      PendingIntent.getActivity(context, entry.id * 2 + 2, it, PendingIntent.FLAG_IMMUTABLE)
    }
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setStyle(style)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setOnlyAlertOnce(!alert)
      .addAction(reply)
      .addInvisibleAction(markRead)
      .setAutoCancel(true)
    launch?.let { builder.setContentIntent(it) }
    try {
      NotificationManagerCompat.from(context).notify(entry.id, builder.build())
    } catch (_: SecurityException) {
      // Notifications not allowed; nothing reaches the car.
    }
  }

  fun replyText(intent: Intent): String? =
    RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY_KEY)?.toString()?.trim()
      ?.takeIf { it.isNotEmpty() }
}

/** The car's reply and mark-as-read actions. */
class CarMessageReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val conversation = intent.getStringExtra(CarMessaging.EXTRA_CONVERSATION) ?: return
    when (intent.action) {
      CarMessaging.ACTION_REPLY -> {
        val text = CarMessaging.replyText(intent) ?: return
        CarMessaging.deliverReply(context, conversation, text)
      }
      CarMessaging.ACTION_READ -> CarMessaging.markRead(context, conversation)
    }
  }
}
