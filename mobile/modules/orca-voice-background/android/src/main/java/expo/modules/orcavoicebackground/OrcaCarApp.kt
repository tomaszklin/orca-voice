package expo.modules.orcavoicebackground

import android.content.Intent
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
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.Locale

/**
 * Orca Voice fork: Orca's own screen in Android Auto. A list of the agents auto-read follows,
 * each with its last message; Read speaks it with Orca's reader (the voice and options set on the
 * phone), Reply records a spoken answer through the car's microphone and types it into the agent.
 *
 * The data comes from JS ([CarState.setAgents], every auto-read poll); the car's buttons go back
 * to JS as `onCarAction`, and the reader's buttons through [ReadAloudControls].
 */
class OrcaCarAppService : CarAppService() {
  // Sideloaded and signed with a debug key: Android Auto's own host is the only caller anyway.
  override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR

  @Deprecated("Kept for hosts below car API 6")
  override fun onCreateSession(): Session = OrcaCarSession()
}

class OrcaCarSession : Session() {
  override fun onCreateScreen(intent: Intent): Screen = AgentListScreen(carContext)
}

/** Polish on a Polish phone, English elsewhere, like the reader's own words. */
internal object CarWords {
  private val pl get() = Locale.getDefault().language == "pl"
  val noAgents get() = if (pl) "Brak agentów. Włącz auto-czytanie w Orce na telefonie." else "No agents. Turn on auto-read in Orca on the phone."
  val read get() = if (pl) "Czytaj" else "Read"
  val reply get() = if (pl) "Odpowiedz" else "Reply"
  val stop get() = if (pl) "Stop" else "Stop"
  val pause get() = if (pl) "Pauza" else "Pause"
  val play get() = if (pl) "Wznów" else "Play"
  val next get() = if (pl) "Dalej" else "Next"
  val send get() = if (pl) "Wyślij" else "Send"
  val again get() = if (pl) "Jeszcze raz" else "Again"
  val listening get() = if (pl) "Słucham…" else "Listening…"
  val noMessage get() = if (pl) "Brak wiadomości." else "No message yet."
  val notHeard get() = if (pl) "Nie usłyszałem. Spróbuj jeszcze raz." else "Didn't catch that. Try again."
  val neverUpdated get() = if (pl) "(Orka na telefonie jeszcze nic nie przysłała.)" else "(Orca on the phone has sent nothing yet.)"
  fun updatedAgo(seconds: Long) = if (pl) "(Lista z telefonu sprzed $seconds s.)" else "(List from the phone, $seconds s ago.)"
  val sending get() = if (pl) "Wysyłam…" else "Sending…"
  fun state(state: String): String = when (state) {
    "working" -> if (pl) "pracuje" else "working"
    "done" -> if (pl) "skończył" else "done"
    "waiting", "blocked" -> if (pl) "czeka na ciebie" else "waiting for you"
    else -> state
  }
}

data class CarAgent(val paneKey: String, val project: String, val state: String, val message: String?)

/** What the car shows, pushed from JS, and the screens to redraw when it changes. */
object CarState {
  @Volatile var agents: List<CarAgent> = emptyList()
    private set
  @Volatile var readerState: String = "idle"
    private set
  /** When JS last sent the list, 0 = never: shown on an empty list, to tell why it is empty. */
  @Volatile var updatedAt: Long = 0
    private set
  /** JS: `onCarAction` with `action` read | reply and the pane, plus `text` for a reply. */
  @Volatile var actionListener: ((action: String, paneKey: String, text: String?) -> Unit)? = null
  private val screens = mutableSetOf<Screen>()
  private val main = Handler(Looper.getMainLooper())
  private var lastResult: ((ok: Boolean, message: String) -> Unit)? = null

  fun setAgents(next: List<CarAgent>) {
    val firstUpdate = updatedAt == 0L
    updatedAt = System.currentTimeMillis()
    if (next == agents && !firstUpdate) {
      return
    }
    agents = next
    redraw()
    CarMediaBrowser.refresh()
  }

  fun setReader(state: String) {
    if (state != readerState) {
      readerState = state
      redraw()
    }
  }

  fun agent(paneKey: String): CarAgent? = agents.firstOrNull { it.paneKey == paneKey }

  fun act(action: String, paneKey: String, text: String? = null, onResult: ((Boolean, String) -> Unit)? = null) {
    lastResult = onResult
    actionListener?.invoke(action, paneKey, text)
  }

  /** JS's answer to a reply: shown as a toast on the car's screen. */
  fun replyResult(ok: Boolean, message: String) {
    main.post {
      lastResult?.invoke(ok, message)
      lastResult = null
    }
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

private fun readerStrip(): ActionStrip {
  val strip = ActionStrip.Builder()
  when (CarState.readerState) {
    "reading" -> strip.addAction(
      Action.Builder().setTitle(CarWords.pause).setOnClickListener { ReadAloudControls.send(ReadAloudControls.PAUSE) }.build()
    )
    "paused", "stopped" -> strip.addAction(
      Action.Builder().setTitle(CarWords.play).setOnClickListener { ReadAloudControls.send(ReadAloudControls.PLAY) }.build()
    )
    else -> strip.addAction(
      Action.Builder().setTitle(CarWords.stop).setOnClickListener { ReadAloudControls.send(ReadAloudControls.STOP_READING) }.build()
    )
  }
  if (CarState.readerState != "idle") {
    strip.addAction(
      Action.Builder().setTitle(CarWords.next).setOnClickListener { ReadAloudControls.send(ReadAloudControls.NEXT) }.build()
    )
  }
  return strip.build()
}

private fun firstLine(text: String?, max: Int): String {
  val line = text?.lineSequence()?.map { it.trim() }?.firstOrNull { it.isNotEmpty() } ?: return ""
  return if (line.length > max) line.take(max - 1) + "…" else line
}

class AgentListScreen(carContext: CarContext) : Screen(carContext) {
  init {
    CarState.attach(this)
  }

  override fun onGetTemplate(): Template {
    val list = ItemList.Builder()
    val agents = CarState.agents
    if (agents.isEmpty()) {
      val updated = CarState.updatedAt
      val age = if (updated == 0L) CarWords.neverUpdated
      else CarWords.updatedAgo((System.currentTimeMillis() - updated) / 1000)
      list.setNoItemsMessage("${CarWords.noAgents} $age")
    }
    agents.take(6).forEach { agent ->
      val row = Row.Builder()
        .setTitle("${agent.project} · ${CarWords.state(agent.state)}")
        .setBrowsable(true)
        .setOnClickListener { screenManager.push(AgentScreen(carContext, agent.paneKey)) }
      firstLine(agent.message, 120).takeIf { it.isNotEmpty() }?.let { row.addText(it) }
      list.addItem(row.build())
    }
    // The build, so the owner can see in the car which one runs ("0.0.67-voice.77" -> "build 77").
    val build = try {
      carContext.packageManager.getPackageInfo(carContext.packageName, 0).versionName
        ?.substringAfter("voice.", "")?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
      null
    }
    return ListTemplate.Builder()
      .setTitle(if (build != null) "Orca · build $build" else "Orca")
      .setHeaderAction(Action.APP_ICON)
      .setSingleList(list.build())
      .setActionStrip(readerStrip())
      .build()
  }
}

class AgentScreen(carContext: CarContext, private val paneKey: String) : Screen(carContext) {
  init {
    CarState.attach(this)
  }

  override fun onGetTemplate(): Template {
    val agent = CarState.agent(paneKey)
    val pane = Pane.Builder()
    val message = agent?.message?.trim().orEmpty()
    if (message.isEmpty()) {
      pane.addRow(Row.Builder().setTitle(CarWords.noMessage).build())
    } else {
      // The car truncates text while driving; the message itself is heard, not read.
      message.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.take(4).forEach {
        pane.addRow(Row.Builder().setTitle(if (it.length > 200) it.take(199) + "…" else it).build())
      }
    }
    pane.addAction(
      Action.Builder().setTitle(CarWords.read).setOnClickListener { CarState.act("read", paneKey) }.build()
    )
    pane.addAction(
      Action.Builder().setTitle(CarWords.reply).setOnClickListener {
        screenManager.push(VoiceReplyScreen(carContext, paneKey))
      }.build()
    )
    return PaneTemplate.Builder(pane.build())
      .setTitle(agent?.let { "${it.project} · ${CarWords.state(it.state)}" } ?: "Orca")
      .setHeaderAction(Action.BACK)
      .setActionStrip(readerStrip())
      .build()
  }
}

/** Listens through the car's microphone, then offers the heard text to send. */
class VoiceReplyScreen(carContext: CarContext, private val paneKey: String) : Screen(carContext) {
  private var heard: String? = null
  private var status: String = CarWords.listening
  private var listening = false
  private val input = CarVoiceInput(carContext)

  init {
    lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onStart(owner: LifecycleOwner) {
        if (heard == null && !listening) {
          listen()
        }
      }

      override fun onDestroy(owner: LifecycleOwner) {
        input.cancel()
      }
    })
  }

  private fun listen() {
    listening = true
    heard = null
    status = CarWords.listening
    // The reader would talk over the user and into the microphone.
    ReadAloudControls.send(ReadAloudControls.PAUSE)
    input.listen { text, error ->
      listening = false
      heard = text
      status = text ?: (error ?: CarWords.notHeard)
      invalidate()
    }
    invalidate()
  }

  override fun onGetTemplate(): Template {
    val title = CarState.agent(paneKey)?.project ?: "Orca"
    val builder = MessageTemplate.Builder(status)
      .setTitle(title)
      .setHeaderAction(Action.BACK)
    val text = heard
    if (text != null) {
      builder.addAction(
        Action.Builder().setTitle(CarWords.send).setOnClickListener {
          status = CarWords.sending
          heard = null
          invalidate()
          CarState.act("reply", paneKey, text) { _, message ->
            CarToast.makeText(carContext, message, CarToast.LENGTH_LONG).show()
            screenManager.pop()
          }
        }.build()
      )
    }
    if (!listening && status != CarWords.sending) {
      builder.addAction(Action.Builder().setTitle(CarWords.again).setOnClickListener { listen() }.build())
    }
    return builder.build()
  }
}
