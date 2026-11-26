package expo.modules.orcavoicebackground

import android.os.Handler
import android.os.Looper
import androidx.car.app.Screen
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import org.json.JSONArray
import org.json.JSONObject

/** Orca Voice fork: what Orca's car screens show, sent by JS, and the car's requests back to JS. */
object CarData {
  data class Host(val id: String, val name: String, val connected: Boolean)

  data class Session(
    val paneKey: String,
    val hostId: String,
    val project: String,
    val title: String,
    val state: String,
    val snippet: String?,
    val canReply: Boolean
  )

  data class Recent(val id: String, val paneKey: String, val project: String, val at: Long, val snippet: String)

  /** One message of a session's chat, newest first in [history]. */
  data class Message(val id: String, val fromUser: Boolean, val at: Long, val snippet: String)

  private data class Snapshot(
    val hosts: List<Host>,
    val sessions: List<Session>,
    val recent: List<Recent>,
    val live: String?
  )

  @Volatile private var snapshot = Snapshot(emptyList(), emptyList(), emptyList(), null)
  val hosts get() = snapshot.hosts
  val sessions get() = snapshot.sessions
  val recent get() = snapshot.recent
  val live get() = snapshot.live

  /** When JS last sent data; 0 = never, which an empty screen says. */
  @Volatile var updatedAt = 0L
    private set
  @Volatile var readerState = "idle"
    private set
  @Volatile var sessionActive = false
    private set
  // Each session's messages, asked of JS when a car view of the session opens.
  @Volatile private var histories: Map<String, List<Message>> = emptyMap()

  /** JS: `onCarRead`, `onCarReply`, `onCarLive`, `onCarHistory` and `onCarSession`, with their payloads. */
  @Volatile var listener: ((event: String, payload: Map<String, Any?>) -> Unit)? = null

  private const val TICK_MS = 8_000L
  private const val REPLY_TIMEOUT_MS = 30_000L
  private val main = Handler(Looper.getMainLooper())
  // Main thread only.
  private val screens = mutableSetOf<Screen>()
  private val replies = mutableMapOf<String, (Boolean, String) -> Unit>()
  private var nextReply = 0
  // The car screens poll through the background reader's tick, which JS hears even off screen.
  private val tick = object : Runnable {
    override fun run() {
      ReadAloudTicker.tick()
      main.postDelayed(this, TICK_MS)
    }
  }

  fun set(json: String) {
    val root = JSONObject(json)
    val next = Snapshot(
      objects(root.optJSONArray("hosts")).map {
        Host(it.getString("id"), it.optString("name").ifEmpty { "Orca" }, it.optBoolean("connected"))
      },
      objects(root.optJSONArray("sessions")).map {
        Session(
          it.getString("paneKey"),
          it.optString("hostId"),
          it.optString("project").ifEmpty { "Orca" },
          it.optString("title").ifEmpty { "Agent" },
          it.optString("state"),
          text(it, "snippet"),
          it.optBoolean("canReply")
        )
      },
      objects(root.optJSONArray("recent")).map {
        Recent(it.getString("id"), it.optString("paneKey"), it.optString("project"), it.optLong("at"), it.optString("snippet"))
      },
      text(root, "live")
    )
    val first = updatedAt == 0L
    updatedAt = System.currentTimeMillis()
    if (first || next != snapshot) {
      snapshot = next
      redraw()
      CarMediaBrowser.refresh()
    }
  }

  private fun objects(array: JSONArray?): List<JSONObject> =
    if (array == null) emptyList() else (0 until array.length()).mapNotNull { array.optJSONObject(it) }

  private fun text(json: JSONObject, key: String): String? = if (json.isNull(key)) null else json.optString(key)

  fun setReader(state: String) {
    if (state != readerState) {
      readerState = state
      redraw()
    }
  }

  fun session(paneKey: String): Session? = sessions.firstOrNull { it.paneKey == paneKey }

  /** Reads a session's last message, or the message `messageId` (of its history or the recent list). */
  fun read(paneKey: String?, messageId: String? = null) {
    listener?.invoke("onCarRead", mapOf("paneKey" to paneKey, "messageId" to messageId))
  }

  /** Null until JS has sent it; asked for the first time a view of the session opens. */
  fun history(paneKey: String): List<Message>? {
    val messages = histories[paneKey]
    if (messages == null) listener?.invoke("onCarHistory", mapOf("paneKey" to paneKey))
    return messages
  }

  fun setHistory(paneKey: String, json: String) {
    val array = JSONArray(json)
    val messages = objects(array).map {
      Message(it.getString("id"), it.optBoolean("fromUser"), it.optLong("at"), it.optString("snippet"))
    }
    if (histories[paneKey] != messages) {
      histories = histories + (paneKey to messages)
      redraw()
      CarMediaBrowser.refresh()
    }
  }

  /** `announce`: the reader says so, for the media list, which has no toast. */
  fun setLive(paneKey: String?, announce: Boolean = false) {
    listener?.invoke("onCarLive", mapOf("paneKey" to paneKey, "announce" to announce))
  }

  /** Main thread. `onResult` runs once: with JS's answer, or a failure when JS is gone or silent. */
  fun reply(paneKey: String, text: String, onResult: (Boolean, String) -> Unit) {
    val send = listener ?: return onResult(false, CarWords.phoneAppGone)
    val id = "reply-${nextReply++}"
    replies[id] = onResult
    main.postDelayed({ replies.remove(id)?.invoke(false, CarWords.noAnswer) }, REPLY_TIMEOUT_MS)
    send("onCarReply", mapOf("requestId" to id, "paneKey" to paneKey, "text" to text))
  }

  fun replyResult(requestId: String, ok: Boolean, message: String) {
    main.post { replies.remove(requestId)?.invoke(ok, message) }
  }

  fun sessionStarted() {
    sessionActive = true
    listener?.invoke("onCarSession", mapOf("active" to true))
    main.removeCallbacks(tick)
    main.post(tick)
  }

  fun sessionEnded() {
    sessionActive = false
    main.removeCallbacks(tick)
    listener?.invoke("onCarSession", mapOf("active" to false))
  }

  fun attach(screen: Screen) {
    main.post { screens.add(screen) }
    screen.lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onDestroy(owner: LifecycleOwner) {
        screens.remove(screen)
      }
    })
  }

  private fun redraw() {
    main.post { screens.toList().forEach { it.invalidate() } }
  }
}
