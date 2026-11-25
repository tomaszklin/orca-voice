package expo.modules.orcavoicebackground

import android.content.pm.ApplicationInfo
import android.media.MediaDescription
import android.media.browse.MediaBrowser
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.service.media.MediaBrowserService
import java.util.Locale

/** Orca Voice fork: Orca as an Android Auto media app; picking an agent reads its last message. */
class CarMediaBrowser : MediaBrowserService() {
  override fun onCreate() {
    super.onCreate()
    instance = this
    sessionToken = ReadAloudMediaSession.keep(this)
  }

  override fun onDestroy() {
    instance = null
    ReadAloudMediaSession.letGo()
    super.onDestroy()
  }

  // The list carries agents' messages, so only Android Auto, system apps and Orca may browse it.
  override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot? =
    if (trusted(clientPackageName, clientUid)) BrowserRoot(ROOT, null) else null

  private fun trusted(packageName: String, uid: Int): Boolean =
    uid == Process.myUid() || packageName == ANDROID_AUTO || runCatching {
      (packageManager.getApplicationInfo(packageName, 0).flags and ApplicationInfo.FLAG_SYSTEM) != 0
    }.getOrDefault(false)

  override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowser.MediaItem>>) {
    result.sendResult(
      when (parentId) {
        // Cars take only browsable items at the root, shown as tabs.
        ROOT -> mutableListOf(item(AGENTS, CarWords.agents, null, MediaBrowser.MediaItem.FLAG_BROWSABLE))
        AGENTS -> agentItems()
        else -> mutableListOf()
      }
    )
  }

  private fun agentItems(): MutableList<MediaBrowser.MediaItem> {
    val agents = CarAgents.list
    if (agents.isEmpty()) {
      val updatedAt = CarAgents.updatedAt
      val note = if (updatedAt == 0L) CarWords.neverUpdated
      else CarWords.updatedAgo((System.currentTimeMillis() - updatedAt) / 1000)
      return mutableListOf(item(EMPTY, CarWords.noAgents, note, MediaBrowser.MediaItem.FLAG_PLAYABLE))
    }
    return agents.map {
      item(
        PANE_PREFIX + it.paneKey,
        "${it.project} · ${CarWords.state(it.state)}",
        it.snippet ?: CarWords.noMessage,
        MediaBrowser.MediaItem.FLAG_PLAYABLE
      )
    }.toMutableList()
  }

  private fun item(id: String, title: String, subtitle: String?, flags: Int) =
    MediaBrowser.MediaItem(MediaDescription.Builder().setMediaId(id).setTitle(title).setSubtitle(subtitle).build(), flags)

  companion object {
    private const val ANDROID_AUTO = "com.google.android.projection.gearhead"
    private const val ROOT = "orca-root"
    private const val AGENTS = "orca-agents"
    private const val EMPTY = "orca-empty"
    private const val PANE_PREFIX = "pane:"
    @Volatile private var instance: CarMediaBrowser? = null
    private val main = Handler(Looper.getMainLooper())

    fun refresh() {
      main.post { instance?.notifyChildrenChanged(AGENTS) }
    }

    fun play(mediaId: String?) {
      val paneKey = mediaId?.takeIf { it.startsWith(PANE_PREFIX) }?.removePrefix(PANE_PREFIX) ?: return
      CarAgents.readListener?.invoke(paneKey)
    }
  }
}

/** The agents auto-read follows, sent by JS; a picked one goes back to JS to be read. */
object CarAgents {
  data class Agent(val paneKey: String, val project: String, val state: String, val snippet: String?)

  @Volatile var list: List<Agent> = emptyList()
    private set
  /** When JS last sent the list; 0 = never, which the car shows to tell why the list is empty. */
  @Volatile var updatedAt = 0L
    private set
  @Volatile var readListener: ((paneKey: String) -> Unit)? = null

  fun set(next: List<Agent>) {
    val first = updatedAt == 0L
    updatedAt = System.currentTimeMillis()
    if (first || next != list) {
      list = next
      CarMediaBrowser.refresh()
    }
  }
}

/** Polish on a Polish phone, English elsewhere. */
internal object CarWords {
  private val pl get() = Locale.getDefault().language == "pl"
  val agents get() = if (pl) "Agenci" else "Agents"
  val noAgents get() = if (pl) "Brak agentów. Włącz auto-czytanie w Orce na telefonie." else "No agents. Turn on auto-read in Orca on the phone."
  val noMessage get() = if (pl) "Brak wiadomości." else "No message yet."
  val neverUpdated get() = if (pl) "Orka na telefonie jeszcze nic nie przysłała." else "Orca on the phone has sent nothing yet."
  fun updatedAgo(seconds: Long) = if (pl) "Lista z telefonu sprzed $seconds s." else "List from the phone, $seconds s ago."
  fun state(state: String): String = when (state) {
    "working" -> if (pl) "pracuje" else "working"
    "done" -> if (pl) "skończył" else "done"
    "waiting", "blocked" -> if (pl) "czeka na ciebie" else "waiting for you"
    else -> state
  }
}
