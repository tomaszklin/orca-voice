package expo.modules.orcavoicebackground

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.CarToast
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.text.DateFormat
import java.util.Date
import java.util.Locale

/**
 * Orca Voice fork: Orca's own screens in Android Auto: computer, project, session, then listen,
 * follow the turn live, or reply by voice. Row titles stay fixed while a screen is open, so the
 * host takes every update as a refresh; Refresh reopens a list with what changed.
 */
class OrcaCarAppService : CarAppService() {
  override fun createHostValidator(): HostValidator =
    if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    else HostValidator.Builder(applicationContext).addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample).build()

  @Deprecated("Kept for hosts below car API 6")
  override fun onCreateSession(): Session = OrcaCarSession()
}

class OrcaCarSession : Session() {
  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onCreate(owner: LifecycleOwner) = CarData.sessionStarted()
      override fun onDestroy(owner: LifecycleOwner) = CarData.sessionEnded()
    })
  }

  override fun onCreateScreen(intent: Intent): Screen = HostsScreen(carContext)
}

private fun action(title: String, onClick: () -> Unit): Action =
  Action.Builder().setTitle(title).setOnClickListener { onClick() }.build()

private fun readerAction(): Action = when (CarData.readerState) {
  "reading" -> action(CarWords.pause) { ReadAloudControls.send(ReadAloudControls.PAUSE) }
  "paused", "stopped" -> action(CarWords.play) { ReadAloudControls.send(ReadAloudControls.PLAY) }
  else -> action(CarWords.stop) { ReadAloudControls.send(ReadAloudControls.STOP_READING) }
}

private fun firstLines(text: String?, count: Int, max: Int): List<String> =
  text.orEmpty().lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.take(count)
    .map { if (it.length > max) it.take(max - 1) + "…" else it }.toList()

private fun sessionStatus(session: CarData.Session?): String = when {
  session == null -> CarWords.ended
  session.paneKey == CarData.live -> "${CarWords.state(session.state)} · ${CarWords.liveOn}"
  else -> CarWords.state(session.state)
}

abstract class OrcaScreen(carContext: CarContext) : Screen(carContext) {
  init {
    CarData.attach(this)
  }

  /** A list's rows are fixed when it opens; this reopens it with the current ones. */
  protected fun reopen(next: () -> Screen) {
    screenManager.pop()
    screenManager.push(next())
  }

  protected fun listStrip(next: () -> Screen): ActionStrip =
    ActionStrip.Builder().addAction(action(CarWords.refresh) { reopen(next) }).addAction(readerAction()).build()
}

class HostsScreen(carContext: CarContext) : OrcaScreen(carContext) {
  private val openedAt = System.currentTimeMillis()
  private val main = Handler(Looper.getMainLooper())

  override fun onGetTemplate(): Template {
    // Loading until the phone's first data, so its arrival is a refresh, not another step.
    if (CarData.updatedAt == 0L && System.currentTimeMillis() - openedAt < WAIT_MS) {
      main.postDelayed({ invalidate() }, WAIT_MS)
      return ListTemplate.Builder().setTitle("Orca").setHeaderAction(Action.APP_ICON).setLoading(true).build()
    }
    val list = ItemList.Builder()
    list.addItem(
      Row.Builder().setTitle(CarWords.recent).addText(CarWords.count(CarData.recent.size)).setBrowsable(true)
        .setOnClickListener { screenManager.push(RecentScreen(carContext)) }.build()
    )
    CarData.hosts.forEach { host ->
      val sessions = CarData.sessions.filter { it.hostId == host.id }
      val text = if (!host.connected) CarWords.disconnected
      else CarWords.summary(sessions.map { it.project }.distinct().size, sessions.size, sessions.count { it.state != "done" })
      list.addItem(
        Row.Builder().setTitle(host.name).addText(text).setBrowsable(true)
          .setOnClickListener { screenManager.push(ProjectsScreen(carContext, host.id, host.name)) }.build()
      )
    }
    if (CarData.hosts.isEmpty()) {
      list.addItem(Row.Builder().setTitle(CarWords.noHosts).addText(CarWords.updated()).build())
    }
    return ListTemplate.Builder().setTitle("Orca").setHeaderAction(Action.APP_ICON).setSingleList(list.build())
      .setActionStrip(ActionStrip.Builder().addAction(readerAction()).build()).build()
  }

  private companion object {
    const val WAIT_MS = 6_000L
  }
}

class ProjectsScreen(carContext: CarContext, private val hostId: String, private val hostName: String) :
  OrcaScreen(carContext) {
  private val projects = CarData.sessions.filter { it.hostId == hostId }.map { it.project }.distinct()

  override fun onGetTemplate(): Template {
    val list = ItemList.Builder().setNoItemsMessage(CarWords.noSessions)
    projects.forEach { project ->
      val sessions = CarData.sessions.filter { it.hostId == hostId && it.project == project }
      list.addItem(
        Row.Builder().setTitle(project).addText(CarWords.summary(null, sessions.size, sessions.count { it.state != "done" }))
          .setBrowsable(true).setOnClickListener { screenManager.push(SessionsScreen(carContext, hostId, project)) }.build()
      )
    }
    return ListTemplate.Builder().setTitle(hostName).setHeaderAction(Action.BACK).setSingleList(list.build())
      .setActionStrip(listStrip { ProjectsScreen(carContext, hostId, hostName) }).build()
  }
}

class SessionsScreen(carContext: CarContext, private val hostId: String, private val project: String) :
  OrcaScreen(carContext) {
  private val opened = CarData.sessions.filter { it.hostId == hostId && it.project == project }
    .map { it.paneKey to it.title }

  override fun onGetTemplate(): Template {
    val list = ItemList.Builder().setNoItemsMessage(CarWords.noSessions)
    opened.forEach { (paneKey, title) ->
      val session = CarData.session(paneKey)
      val row = Row.Builder().setTitle(title).addText(sessionStatus(session))
      firstLines(session?.snippet, 1, 120).firstOrNull()?.let { row.addText(it) }
      list.addItem(
        row.setBrowsable(true).setOnClickListener { screenManager.push(SessionScreen(carContext, paneKey, title)) }.build()
      )
    }
    return ListTemplate.Builder().setTitle(project).setHeaderAction(Action.BACK).setSingleList(list.build())
      .setActionStrip(listStrip { SessionsScreen(carContext, hostId, project) }).build()
  }
}

class SessionScreen(carContext: CarContext, private val paneKey: String, private val title: String) :
  OrcaScreen(carContext) {
  override fun onGetTemplate(): Template {
    val session = CarData.session(paneKey)
    val message = Row.Builder().setTitle(CarWords.lastMessage)
    val lines = firstLines(session?.snippet, 2, 160)
    if (lines.isEmpty()) message.addText(CarWords.noMessage) else lines.forEach { message.addText(it) }
    val pane = Pane.Builder()
      .addRow(Row.Builder().setTitle(CarWords.status).addText(sessionStatus(session)).build())
      .addRow(message.build())
      .addAction(action(CarWords.listen) { CarData.read(paneKey) })
      .addAction(
        action(CarWords.reply) {
          if (session?.canReply == true) screenManager.push(ReplyScreen(carContext, paneKey, title))
          else CarToast.makeText(carContext, CarWords.cannotReply, CarToast.LENGTH_LONG).show()
        }
      )
    val live = paneKey == CarData.live
    val liveAction = action(if (live) CarWords.liveStop else CarWords.liveStart) {
      CarData.setLive(if (live) null else paneKey)
      CarToast.makeText(carContext, if (live) CarWords.liveStopped else CarWords.liveStarted, CarToast.LENGTH_SHORT).show()
    }
    return PaneTemplate.Builder(pane.build()).setTitle(title).setHeaderAction(Action.BACK)
      .setActionStrip(ActionStrip.Builder().addAction(liveAction).addAction(readerAction()).build()).build()
  }
}

/** Listens through the car's microphone; Send types what was heard into the session. */
class ReplyScreen(carContext: CarContext, private val paneKey: String, private val title: String) :
  OrcaScreen(carContext) {
  private val input = CarVoiceInput(carContext)
  private var status = CarWords.listening
  private var heard: String? = null
  private var busy = false
  private var listenedOnce = false
  // Paused here for the microphone, so leaving the screen lets it go on.
  private var resumeReader = false

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onStart(owner: LifecycleOwner) {
        if (!listenedOnce) listen()
      }

      override fun onDestroy(owner: LifecycleOwner) {
        input.cancel()
        if (resumeReader) ReadAloudControls.send(ReadAloudControls.PLAY)
      }
    })
  }

  private fun listen() {
    if (busy) return
    listenedOnce = true
    busy = true
    heard = null
    status = CarWords.listening
    // The reader would talk over the user and into the microphone.
    if (CarData.readerState == "reading") {
      resumeReader = true
      ReadAloudControls.send(ReadAloudControls.PAUSE)
    }
    input.listen { text, error ->
      busy = false
      heard = text
      status = text ?: error ?: CarWords.notHeard
      invalidate()
    }
    invalidate()
  }

  private fun send() {
    val text = heard
    if (busy || text == null) {
      CarToast.makeText(carContext, if (busy) CarWords.wait else CarWords.sayFirst, CarToast.LENGTH_SHORT).show()
      return
    }
    busy = true
    status = CarWords.sending
    invalidate()
    CarData.reply(paneKey, text) { _, message ->
      busy = false
      heard = null
      status = message
      CarToast.makeText(carContext, message, CarToast.LENGTH_LONG).show()
      if (screenManager.top === this) screenManager.pop() else invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val pane = Pane.Builder()
      .addRow(Row.Builder().setTitle(CarWords.yourReply).addText(status).build())
      .addAction(action(CarWords.send) { send() })
      .addAction(action(CarWords.again) { listen() })
    return PaneTemplate.Builder(pane.build()).setTitle(title).setHeaderAction(Action.BACK).build()
  }
}

class RecentScreen(carContext: CarContext) : OrcaScreen(carContext) {
  private val opened = CarData.recent
  private val time = DateFormat.getTimeInstance(DateFormat.SHORT, Locale.getDefault())

  override fun onGetTemplate(): Template {
    val list = ItemList.Builder().setNoItemsMessage(CarWords.noRecent)
    opened.forEach { recent ->
      list.addItem(
        Row.Builder().setTitle("${recent.project} · ${time.format(Date(recent.at))}")
          .addText(firstLines(recent.snippet, 1, 160).firstOrNull() ?: CarWords.noMessage)
          .setOnClickListener { CarData.read(recent.paneKey, recent.id) }.build()
      )
    }
    return ListTemplate.Builder().setTitle(CarWords.recent).setHeaderAction(Action.BACK).setSingleList(list.build())
      .setActionStrip(listStrip { RecentScreen(carContext) }).build()
  }
}

/** Polish on a Polish phone, English elsewhere. */
internal object CarWords {
  private val pl get() = Locale.getDefault().language == "pl"
  private fun say(polish: String, english: String) = if (pl) polish else english

  val agents get() = say("Agenci", "Agents")
  val recent get() = say("Ostatnie wiadomości", "Recent messages")
  val noRecent get() = say("Brak wiadomości.", "No messages yet.")
  val noHosts get() = say("Brak komputerów. Otwórz Orkę na telefonie.", "No computers. Open Orca on the phone.")
  val noAgents get() = say("Brak agentów. Otwórz Orkę na telefonie.", "No agents. Open Orca on the phone.")
  val noSessions get() = say("Brak sesji.", "No sessions.")
  val noMessage get() = say("Brak wiadomości.", "No message yet.")
  val disconnected get() = say("Rozłączony", "Disconnected")
  val ended get() = say("Sesja zakończona", "Session ended")
  val status get() = say("Stan", "Status")
  val lastMessage get() = say("Ostatnia wiadomość", "Last message")
  val listen get() = say("Słuchaj", "Listen")
  val reply get() = say("Odpowiedz", "Reply")
  val cannotReply get() = say("Ta sesja nie przyjmuje odpowiedzi z auta.", "This session can't take replies from the car.")
  val liveStart get() = say("Na żywo", "Live")
  val liveStop get() = say("Wyłącz na żywo", "Stop live")
  val liveOn get() = say("na żywo", "live")
  val liveStarted get() = say("Czytam nowe wiadomości tej sesji.", "Reading this session's new messages.")
  val liveStopped get() = say("Na żywo wyłączone.", "Live off.")
  val refresh get() = say("Odśwież", "Refresh")
  val pause get() = say("Pauza", "Pause")
  val play get() = say("Wznów", "Play")
  val stop get() = say("Stop", "Stop")
  val yourReply get() = say("Twoja odpowiedź", "Your reply")
  val listening get() = say("Słucham…", "Listening…")
  val notHeard get() = say("Nie usłyszałem. Naciśnij Jeszcze raz.", "Didn't catch that. Press Again.")
  val send get() = say("Wyślij", "Send")
  val again get() = say("Jeszcze raz", "Again")
  val sending get() = say("Wysyłam…", "Sending…")
  val wait get() = say("Chwilę…", "One moment…")
  val sayFirst get() = say("Najpierw powiedz odpowiedź.", "Say your reply first.")
  val noRecognizer get() = say("Telefon nie rozpoznaje mowy.", "The phone has no speech recognition.")
  val recognizerFailed get() = say("Rozpoznawanie mowy nie zadziałało.", "Speech recognition failed.")
  val phoneAppGone get() = say("Orka na telefonie nie działa.", "Orca isn't running on the phone.")
  val noAnswer get() = say("Telefon nie odpowiedział. Sprawdź, czy wysłano.", "No answer from the phone. Check whether it was sent.")
  val neverUpdated get() = say("Orka na telefonie jeszcze nic nie przysłała.", "Orca on the phone has sent nothing yet.")

  fun updated(): String {
    val at = CarData.updatedAt
    if (at == 0L) return neverUpdated
    val seconds = (System.currentTimeMillis() - at) / 1000
    return say("Dane z telefonu sprzed $seconds s.", "Data from the phone, $seconds s ago.")
  }

  fun count(n: Int) = if (n == 0) noRecent else say("$n wiadomości", "$n messages")

  fun summary(projects: Int?, sessions: Int, busy: Int): String {
    val parts = mutableListOf<String>()
    if (projects != null) parts.add(say("projekty: $projects", "projects: $projects"))
    parts.add(say("sesje: $sessions", "sessions: $sessions"))
    if (busy > 0) parts.add(say("aktywne: $busy", "active: $busy"))
    return parts.joinToString(" · ")
  }

  fun state(state: String): String = when (state) {
    "working" -> say("pracuje", "working")
    "done" -> say("skończył", "done")
    "waiting", "blocked" -> say("czeka na ciebie", "waiting for you")
    else -> state
  }
}
