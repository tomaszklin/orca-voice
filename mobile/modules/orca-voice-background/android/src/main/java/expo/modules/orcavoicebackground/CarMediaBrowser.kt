package expo.modules.orcavoicebackground

import android.content.pm.ApplicationInfo
import android.media.MediaDescription
import android.media.browse.MediaBrowser
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.service.media.MediaBrowserService
import java.text.DateFormat
import java.util.Date
import java.util.Locale

/**
 * Orca Voice fork: Orca as an Android Auto media app, the one car screen a sideloaded app gets.
 * Folders go computer, project, session; a session's items read its last message, follow it live,
 * or post a message the driver answers by voice ([CarReplyNotification]).
 */
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

  // The folders carry agents' messages, so only Android Auto, system apps and Orca may browse them.
  override fun onGetRoot(clientPackageName: String, clientUid: Int, rootHints: Bundle?): BrowserRoot? =
    if (trusted(clientPackageName, clientUid)) BrowserRoot(ROOT, null) else null

  private fun trusted(packageName: String, uid: Int): Boolean =
    uid == Process.myUid() || packageName == ANDROID_AUTO || runCatching {
      (packageManager.getApplicationInfo(packageName, 0).flags and ApplicationInfo.FLAG_SYSTEM) != 0
    }.getOrDefault(false)

  override fun onLoadChildren(parentId: String, result: Result<MutableList<MediaBrowser.MediaItem>>) {
    main.post { shown.add(parentId) }
    val parts = parentId.split(SEPARATOR)
    result.sendResult(
      when (parts[0]) {
        // Cars take only browsable items at the root, shown as tabs.
        ROOT -> mutableListOf(folder(HOSTS, CarWords.computers, null), folder(RECENT, CarWords.recent, null))
        HOSTS -> hostItems()
        HOST -> projectItems(parts.getOrElse(1) { "" })
        PROJECT -> sessionItems(parts.getOrElse(1) { "" }, parts.getOrElse(2) { "" })
        SESSION -> actionItems(parentId.removePrefix(SESSION + SEPARATOR))
        RECENT -> recentItems()
        else -> mutableListOf()
      }
    )
  }

  private fun hostItems(): MutableList<MediaBrowser.MediaItem> {
    val hosts = CarData.hosts
    if (hosts.isEmpty()) return mutableListOf(note(CarWords.noHosts, CarWords.updated()))
    return hosts.map { host ->
      val sessions = CarData.sessions.filter { it.hostId == host.id }
      val text = if (!host.connected) CarWords.disconnected
      else CarWords.summary(sessions.map { it.project }.distinct().size, sessions.size, sessions.count { it.state != "done" })
      folder(id(HOST, host.id), host.name, text)
    }.toMutableList()
  }

  private fun projectItems(hostId: String): MutableList<MediaBrowser.MediaItem> {
    val sessions = CarData.sessions.filter { it.hostId == hostId }
    if (sessions.isEmpty()) return mutableListOf(note(CarWords.noSessions, CarWords.updated()))
    return sessions.map { it.project }.distinct().map { project ->
      val inProject = sessions.filter { it.project == project }
      folder(id(PROJECT, hostId, project), project, CarWords.summary(null, inProject.size, inProject.count { it.state != "done" }))
    }.toMutableList()
  }

  private fun sessionItems(hostId: String, project: String): MutableList<MediaBrowser.MediaItem> {
    val sessions = CarData.sessions.filter { it.hostId == hostId && it.project == project }
    if (sessions.isEmpty()) return mutableListOf(note(CarWords.noSessions, CarWords.updated()))
    return sessions.map { folder(id(SESSION, it.paneKey), it.title, listOfNotNull(status(it), firstLine(it.snippet)).joinToString(" · ")) }
      .toMutableList()
  }

  // Reply first, then the session's messages newest first (owner, 2026-11-26), then Read new.
  private fun actionItems(paneKey: String): MutableList<MediaBrowser.MediaItem> {
    val session = CarData.session(paneKey) ?: return mutableListOf(note(CarWords.ended, null))
    val items = mutableListOf(
      if (session.canReply) playable(id(REPLY, paneKey), CarWords.reply, CarWords.replyHint)
      else note(CarWords.reply, CarWords.cannotReply)
    )
    val history = CarData.history(paneKey)
    val time = DateFormat.getTimeInstance(DateFormat.SHORT, Locale.getDefault())
    when {
      history == null -> items.add(note(CarWords.loading, null))
      history.isEmpty() -> items.add(note(CarWords.noMessage, null))
      else -> history.forEach {
        val who = if (it.fromUser) CarWords.you else CarWords.agent
        items.add(playable(id(MESSAGE, paneKey, it.id), firstLine(it.snippet) ?: CarWords.noMessage, "$who · ${time.format(Date(it.at))}"))
      }
    }
    val live = CarData.live == paneKey
    items.add(playable(id(LIVE, paneKey), "${CarWords.readNew}: ${if (live) CarWords.on else CarWords.off}", CarWords.readNewHint))
    return items
  }

  private fun recentItems(): MutableList<MediaBrowser.MediaItem> {
    val recent = CarData.recent
    if (recent.isEmpty()) return mutableListOf(note(CarWords.noRecent, null))
    val time = DateFormat.getTimeInstance(DateFormat.SHORT, Locale.getDefault())
    return recent.map {
      playable(id(RECENT_ITEM, it.id, it.paneKey), "${it.project} · ${time.format(Date(it.at))}", firstLine(it.snippet))
    }.toMutableList()
  }

  private fun status(session: CarData.Session): String =
    if (session.paneKey == CarData.live) "${CarWords.state(session.state)} · ${CarWords.liveOn}" else CarWords.state(session.state)

  private fun firstLine(text: String?): String? =
    text?.lineSequence()?.map { it.trim() }?.firstOrNull { it.isNotEmpty() }

  private fun item(mediaId: String, title: String, subtitle: String?, flags: Int) =
    MediaBrowser.MediaItem(MediaDescription.Builder().setMediaId(mediaId).setTitle(title).setSubtitle(subtitle).build(), flags)

  private fun folder(mediaId: String, title: String, subtitle: String?) =
    item(mediaId, title, subtitle, MediaBrowser.MediaItem.FLAG_BROWSABLE)

  private fun playable(mediaId: String, title: String, subtitle: String?) =
    item(mediaId, title, subtitle, MediaBrowser.MediaItem.FLAG_PLAYABLE)

  // Something to read where a list would be empty; playing it does nothing.
  private fun note(title: String, subtitle: String?) = playable(NOTE, title, subtitle)

  companion object {
    private const val ANDROID_AUTO = "com.google.android.projection.gearhead"
    private const val SEPARATOR = "\u001f"
    private const val ROOT = "orca-root"
    private const val HOSTS = "orca-hosts"
    private const val RECENT = "orca-recent"
    private const val HOST = "host"
    private const val PROJECT = "project"
    private const val SESSION = "session"
    private const val MESSAGE = "message"
    private const val LIVE = "live"
    private const val REPLY = "reply"
    private const val RECENT_ITEM = "recent"
    private const val NOTE = "orca-note"
    @Volatile private var instance: CarMediaBrowser? = null
    private val main = Handler(Looper.getMainLooper())
    // Main thread: the folders the car has opened, told when their content changes.
    private val shown = mutableSetOf<String>()

    private fun id(vararg parts: String) = parts.joinToString(SEPARATOR)

    fun refresh() {
      main.post {
        val browser = instance ?: return@post
        shown.forEach { browser.notifyChildrenChanged(it) }
      }
    }

    fun play(mediaId: String?) {
      val parts = mediaId?.split(SEPARATOR) ?: return
      val paneKey = parts.getOrNull(1) ?: return
      when (parts[0]) {
        MESSAGE -> CarData.read(paneKey, parts.getOrNull(2))
        RECENT_ITEM -> CarData.read(parts.getOrNull(2), paneKey)
        LIVE -> CarData.setLive(if (CarData.live == paneKey) null else paneKey, announce = true)
        REPLY -> instance?.let { CarReplyNotification.post(it.applicationContext, paneKey) }
      }
    }
  }
}
