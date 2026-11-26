package expo.modules.orcavoicebackground

import android.content.pm.ApplicationInfo
import android.media.MediaDescription
import android.media.browse.MediaBrowser
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.service.media.MediaBrowserService

/** Orca Voice fork: Orca as an Android Auto media app; picking an agent reads its last message. */
class CarMediaBrowser : MediaBrowserService() {
  override fun onCreate() {
    super.onCreate()
    instance = this
    sessionToken = ReadAloudMediaSession.keep(this)
    ReadAloudSpeech.setForCar(true)
  }

  override fun onDestroy() {
    instance = null
    ReadAloudSpeech.setForCar(false)
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
    val sessions = CarData.sessions
    if (sessions.isEmpty()) {
      return mutableListOf(item(EMPTY, CarWords.noAgents, CarWords.updated(), MediaBrowser.MediaItem.FLAG_PLAYABLE))
    }
    return sessions.map {
      val snippet = it.snippet?.lineSequence()?.map { line -> line.trim() }?.firstOrNull { line -> line.isNotEmpty() }
      item(
        PANE_PREFIX + it.paneKey,
        "${it.project} · ${it.title}",
        listOfNotNull(CarWords.state(it.state), snippet).joinToString(" · "),
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
      CarData.read(paneKey)
    }
  }
}
