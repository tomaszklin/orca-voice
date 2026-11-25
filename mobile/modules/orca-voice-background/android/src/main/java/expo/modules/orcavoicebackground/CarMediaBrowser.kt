package expo.modules.orcavoicebackground

import android.media.MediaDescription
import android.media.browse.MediaBrowser
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.media.MediaBrowserService

/**
 * Orca Voice fork: Orca as a media app in Android Auto, the kind of app the car always lists
 * (build 77's own car screen, category IOT, was not listed). The root lists the agents auto-read
 * follows ([CarState], pushed from JS); picking one reads its last message with Orca's reader,
 * in the voice set on the phone. The player's buttons are the reader's, through the session of
 * [ReadAloudMediaSession], which stays while the car is connected.
 */
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

  override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot =
    BrowserRoot(ROOT, null)

  override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowser.MediaItem>>) {
    if (parentId != ROOT) {
      result.sendResult(mutableListOf())
      return
    }
    val items = CarState.agents.map { agent ->
      val description = MediaDescription.Builder()
        .setMediaId(PANE_PREFIX + agent.paneKey)
        .setTitle("${agent.project} · ${CarWords.state(agent.state)}")
        .setSubtitle(agent.message?.lineSequence()?.map { it.trim() }?.firstOrNull { it.isNotEmpty() } ?: CarWords.noMessage)
        .build()
      MediaBrowser.MediaItem(description, MediaBrowser.MediaItem.FLAG_PLAYABLE)
    }.toMutableList()
    if (items.isEmpty()) {
      val updated = CarState.updatedAt
      val note = if (updated == 0L) CarWords.neverUpdated
      else CarWords.updatedAgo((System.currentTimeMillis() - updated) / 1000)
      items.add(
        MediaBrowser.MediaItem(
          MediaDescription.Builder().setMediaId(EMPTY).setTitle(CarWords.noAgents).setSubtitle(note).build(),
          MediaBrowser.MediaItem.FLAG_PLAYABLE
        )
      )
    }
    result.sendResult(items)
  }

  companion object {
    private const val ROOT = "orca-root"
    private const val EMPTY = "orca-empty"
    private const val PANE_PREFIX = "pane:"
    @Volatile private var instance: CarMediaBrowser? = null
    private val main = Handler(Looper.getMainLooper())

    /** The list changed: the car asks for it again. */
    fun refresh() {
      main.post { instance?.notifyChildrenChanged(ROOT) }
    }

    /** A picked item: reads that agent's last message. */
    fun play(mediaId: String?) {
      val paneKey = mediaId?.takeIf { it.startsWith(PANE_PREFIX) }?.removePrefix(PANE_PREFIX) ?: return
      CarState.act("read", paneKey)
    }
  }
}
