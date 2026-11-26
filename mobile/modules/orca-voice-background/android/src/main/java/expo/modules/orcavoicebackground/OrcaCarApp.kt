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
import androidx.car.app.model.Toggle
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
      else CarWords.summary(CarData.projects.count { it.hostId == host.id }, sessions.size, sessions.count { it.state != "done" })
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
  private val projects = CarData.projects.filter { it.hostId == hostId }.map { it.name }

  override fun onGetTemplate(): Template {
    val list = ItemList.Builder().setNoItemsMessage(CarWords.noProjects)
    projects.forEach { project ->
      val sessions = CarData.sessions.filter { it.hostId == hostId && it.project == project }
      val text = if (sessions.isEmpty()) CarWords.noSessions
      else CarWords.summary(null, sessions.size, sessions.count { it.state != "done" })
      list.addItem(
        Row.Builder().setTitle(project).addText(text)
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
    val list = ItemList.Builder()
    list.addItem(
      Row.Builder().setTitle(CarWords.newSession).addText(CarWords.newSessionHint).setBrowsable(true)
        .setOnClickListener { startSession() }.build()
    )
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

  // A Claude chat in this project; its first message is dictated like any reply.
  private fun startSession() {
    CarToast.makeText(carContext, CarWords.creating, CarToast.LENGTH_SHORT).show()
    CarData.newSession(hostId, project, announce = false) { ok, value ->
      if (ok) screenManager.push(ReplyScreen(carContext, value, CarWords.newSession))
      else CarToast.makeText(carContext, value, CarToast.LENGTH_LONG).show()
    }
  }
}

/** Who wrote a message and when, for its row. */
private fun messageLabel(message: CarData.Message): String {
  val time = DateFormat.getTimeInstance(DateFormat.SHORT, Locale.getDefault()).format(Date(message.at))
  return "${if (message.fromUser) CarWords.you else CarWords.agent} · $time"
}

/**
 * Reply first, then the newest messages (owner, 2026-11-26). Rows are named by place, newest first,
 * so a new message is a refresh, not another step; all of them are one row further on.
 */
class SessionScreen(carContext: CarContext, private val paneKey: String, private val title: String) :
  OrcaScreen(carContext) {
  override fun onGetTemplate(): Template {
    val session = CarData.session(paneKey)
    val history = CarData.history(paneKey)
    val list = ItemList.Builder()
    val reply = Row.Builder().setTitle(CarWords.reply).addText(sessionStatus(session))
    if (session?.canReply == true) {
      reply.setBrowsable(true).setOnClickListener { screenManager.push(ReplyScreen(carContext, paneKey, title)) }
    } else {
      reply.addText(CarWords.cannotReply)
    }
    list.addItem(reply.build())
    PLACES.forEachIndexed { index, place ->
      val message = history?.getOrNull(index)
      val row = Row.Builder().setTitle(place())
      when {
        history == null -> row.addText(CarWords.loading)
        message == null -> row.addText(CarWords.noMessage)
        else -> {
          row.addText(messageLabel(message))
          firstLines(message.snippet, 1, 160).firstOrNull()?.let { row.addText(it) }
          row.setOnClickListener { CarData.read(paneKey, message.id) }
        }
      }
      list.addItem(row.build())
    }
    list.addItem(
      Row.Builder().setTitle(CarWords.allMessages).setBrowsable(true)
        .setOnClickListener { screenManager.push(HistoryScreen(carContext, paneKey, title)) }.build()
    )
    val live = paneKey == CarData.live
    list.addItem(
      Row.Builder().setTitle(CarWords.readNew).addText(CarWords.readNewHint)
        .setToggle(Toggle.Builder { on -> CarData.setLive(if (on) paneKey else null) }.setChecked(live).build()).build()
    )
    return ListTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK).setSingleList(list.build())
      .setActionStrip(ActionStrip.Builder().addAction(readerAction()).build()).build()
  }

  private companion object {
    val PLACES = listOf({ CarWords.newest }, { CarWords.previous }, { CarWords.earlier })
  }
}

/** All of a session's messages as they were when it opened, newest first; Refresh reopens it. */
class HistoryScreen(carContext: CarContext, private val paneKey: String, private val title: String) :
  OrcaScreen(carContext) {
  private val opened = CarData.history(paneKey).orEmpty()

  override fun onGetTemplate(): Template {
    val list = ItemList.Builder().setNoItemsMessage(CarWords.noMessage)
    opened.forEach { message ->
      list.addItem(
        Row.Builder().setTitle(firstLines(message.snippet, 1, 120).firstOrNull() ?: CarWords.noMessage)
          .addText(messageLabel(message)).setOnClickListener { CarData.read(paneKey, message.id) }.build()
      )
    }
    return ListTemplate.Builder().setTitle(title).setHeaderAction(Action.BACK).setSingleList(list.build())
      .setActionStrip(listStrip { HistoryScreen(carContext, paneKey, title) }).build()
  }
}

/**
 * Listens through the car's microphone until Send: each pause ends one recognition and the next
 * starts at once, so a pause never ends the reply (Android Auto's own dictation did, owner
 * 2026-11-26). It stops after a long silence; Continue picks it up again.
 */
class ReplyScreen(carContext: CarContext, private val paneKey: String, private val title: String) :
  OrcaScreen(carContext) {
  private val input = CarVoiceInput(carContext)
  private val parts = mutableListOf<String>()
  private var listening = false
  private var sending = false
  private var quietRounds = 0
  private var problem: String? = null
  private var started = false
  // Paused here for the microphone, so leaving the screen lets it go on.
  private var resumeReader = false

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onStart(owner: LifecycleOwner) {
        if (!started) {
          started = true
          listen()
        }
      }

      override fun onDestroy(owner: LifecycleOwner) {
        listening = false
        input.cancel()
        if (resumeReader) ReadAloudControls.send(ReadAloudControls.PLAY)
      }
    })
  }

  private fun listen() {
    if (sending) return
    // The reader would talk over the user and into the microphone.
    if (CarData.readerState == "reading") {
      resumeReader = true
      ReadAloudControls.send(ReadAloudControls.PAUSE)
    }
    listening = true
    quietRounds = 0
    problem = null
    next()
    invalidate()
  }

  private fun next() {
    input.listen { text, error ->
      if (!listening) return@listen
      when {
        text != null -> {
          parts.add(text)
          quietRounds = 0
        }
        error != null -> {
          problem = error
          listening = false
        }
        ++quietRounds >= QUIET_ROUNDS -> listening = false
      }
      if (listening) next()
      invalidate()
    }
  }

  private fun stop() {
    listening = false
    input.cancel()
  }

  private fun send() {
    if (sending) return
    stop()
    val text = parts.joinToString(" ").trim()
    if (text.isEmpty()) {
      CarToast.makeText(carContext, CarWords.sayFirst, CarToast.LENGTH_SHORT).show()
      invalidate()
      return
    }
    sending = true
    invalidate()
    CarData.reply(paneKey, text) { ok, message ->
      sending = false
      CarToast.makeText(carContext, message, CarToast.LENGTH_LONG).show()
      if (ok) parts.clear() else problem = message
      if (ok && screenManager.top === this) screenManager.pop() else invalidate()
    }
  }

  override fun onGetTemplate(): Template {
    val heard = parts.joinToString(" ").trim()
    val status = when {
      sending -> CarWords.sending
      listening -> CarWords.listening
      else -> problem ?: CarWords.stopped
    }
    val row = Row.Builder().setTitle(CarWords.yourReply).addText(heard.ifEmpty { CarWords.sayNow }).addText(status)
    val pane = Pane.Builder().addRow(row.build())
      .addAction(action(CarWords.send) { send() })
      .addAction(
        if (listening) action(CarWords.startOver) { stop(); parts.clear(); listen() }
        else action(CarWords.goOn) { listen() }
      )
    return PaneTemplate.Builder(pane.build()).setTitle(title).setHeaderAction(Action.BACK).build()
  }

  private companion object {
    // About a minute of silence: each quiet round is the recognizer's own timeout.
    const val QUIET_ROUNDS = 6
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
  val agent get() = say("Agent", "Agent")
  val noProjects get() = say("Brak projektów.", "No projects.")
  val newSession get() = say("Nowa sesja", "New session")
  val newSessionHint get() = say("Czat Claude w tym projekcie. Pierwszą wiadomość podyktujesz.", "A Claude chat in this project. You dictate its first message.")
  val creating get() = say("Tworzę nową sesję…", "Creating a new session…")
  val firstMessagePrompt get() = say("Podyktuj pierwszą wiadomość.", "Say the first message.")
  val newest get() = say("Najnowsza", "Newest")
  val previous get() = say("Poprzednia", "Previous")
  val earlier get() = say("Wcześniejsza", "Earlier")
  val allMessages get() = say("Wszystkie wiadomości", "All messages")
  val loading get() = say("Wczytuję…", "Loading…")
  val readNew get() = say("Czytaj nowe wiadomości tej sesji", "Read this session's new messages")
  val readNewHint get() = say("Na bieżąco, a innych sesji nie.", "As they come, and no other session's.")
  val startOver get() = say("Od nowa", "Start over")
  val goOn get() = say("Mów dalej", "Continue")
  val stopped get() = say("Przerwa. Wyślij albo mów dalej.", "Paused. Send or continue.")
  val sayNow get() = say("Mów. Pauzy nie przerywają.", "Speak. Pauses don't stop it.")
  val computers get() = say("Komputery", "Computers")
  val on get() = say("włączone", "on")
  val off get() = say("wyłączone", "off")
  val replyHint get() = say("Przyjdzie wiadomość. Odpowiedz na nią głosem.", "A message comes. Answer it by voice.")
  val replyPrompt get() = say("Podyktuj odpowiedź.", "Say your reply.")
  val replyChannel get() = say("Odpowiedzi z auta", "Replies from the car")
  val you get() = say("Ty", "You")
  val done get() = say("Przeczytane", "Read")
  val recent get() = say("Ostatnie wiadomości", "Recent messages")
  val noRecent get() = say("Brak wiadomości.", "No messages yet.")
  val noHosts get() = say("Brak komputerów. Otwórz Orkę na telefonie.", "No computers. Open Orca on the phone.")
  val noAgents get() = say("Brak agentów. Otwórz Orkę na telefonie.", "No agents. Open Orca on the phone.")
  val noSessions get() = say("Brak sesji.", "No sessions.")
  val noMessage get() = say("Brak wiadomości.", "No message yet.")
  val disconnected get() = say("Rozłączony", "Disconnected")
  val ended get() = say("Sesja zakończona", "Session ended")
  val reply get() = say("Odpowiedz", "Reply")
  val cannotReply get() = say("Ta sesja nie przyjmuje odpowiedzi z auta.", "This session can't take replies from the car.")
  val liveOn get() = say("czytam na bieżąco", "reading as it comes")
  val refresh get() = say("Odśwież", "Refresh")
  val pause get() = say("Pauza", "Pause")
  val play get() = say("Wznów", "Play")
  val stop get() = say("Stop", "Stop")
  val yourReply get() = say("Twoja odpowiedź", "Your reply")
  val listening get() = say("Słucham…", "Listening…")
  val send get() = say("Wyślij", "Send")
  val sending get() = say("Wysyłam…", "Sending…")
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
