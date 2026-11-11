import { playPieceRun } from './piece-player'
import { logSpeechEvent } from './speech-diagnostics'
import { spokenOffset, stopUtterances } from './tts-engine'
import {
  heldByUser,
  holdOverdue,
  previousTarget,
  readerReport,
  readingState,
  remembered,
  type Hold,
  type Parked,
  type Utterance
} from './reader-model'
import { autoReadNeedsHeadphones } from './reader-options'
import { reportReader, useReported } from './reader-report'
import { replyUtterance, withIntro, type ReplyIntro } from './reply-pieces'
import { voiceNativeModule, type ReaderState } from './voice-native-module'

/**
 * Said before a message (auto-read): a chime, then the project name, each a piece of its own.
 * `title` names the message in the notification and on a car's display.
 */
export type { ReplyIntro } from './reply-pieces'
export { autoReadNeedsHeadphones, setAutoReadNeedsHeadphones } from './reader-options'

let queue: Utterance[] = []
/**
 * What Stop or a lost audio left waiting: read only with Play or Next, so a message that comes
 * later is read at once (owner, 2026-11-11: after Stop with 10 waiting, a new message started
 * an old one).
 */
let backlog: Utterance[] = []
let current: Utterance | null = null
/** The piece of `current` being read, where a resume starts again. */
let piece = 0
// Where in its piece the current utterance starts, and where a resume goes on from.
let pieceFrom = 0
let resumeFrom = 0
let hold: Hold | null = null
/** The queue's message the Read button cut in on; it goes on once that one ends. */
let parked: Parked | null = null
/** Messages auto-read read lately, oldest first. */
let history: Utterance[] = []
// Off while auto-read is paused: nothing starts by itself, new messages wait for Play or Next.
let autoPlay = true

function waiting(): number {
  return queue.length + backlog.length
}

function readerState(): ReaderState {
  return readingState(current, hold, waiting())
}

function emit(): void {
  reportReader(readerReport(current, hold, waiting(), parked !== null, history))
}

/** `cutOff` and the queue wait for Play, ahead of what waited before. */
function toBacklog(cutOff: Utterance | null): void {
  // The ids are apart already: a message taken or queued leaves the other lists.
  backlog = [...(cutOff ? [cutOff] : []), ...queue, ...backlog]
  queue = []
}

/** Nothing is read any more; the engine stops. */
function silence(): void {
  current = null
  hold = null
  stopUtterances()
}

/** Makes `utterance` the one being read, from its start. */
function begin(utterance: Utterance): void {
  hold = null
  current = take(utterance)
  emit()
  playPiece(current, 0)
}

/** `utterance` made the current message, its intro decided, not yet played. */
function take(utterance: Utterance): Utterance {
  const started = withIntro(utterance)
  // Why: Previous can pick a message that also waits in the queue, which would read it twice.
  queue = queue.filter((queued) => queued.id !== started.id)
  backlog = backlog.filter((waited) => waited.id !== started.id)
  // What the Read button reads stays outside the queue, so Previous never goes back to it.
  if (started.auto) {
    history = remembered(history, started)
  }
  return started
}

/**
 * `byUser`: Play or Next was pressed, which reads what waits through the speaker too. Without
 * headphones (headphones-only option) the next message waits for them rather than being dropped,
 * as a Bluetooth hiccup when it arrived lost it for good (review, 2026-11-11).
 */
function playNext(byUser = false): void {
  if (byUser && queue.length === 0) {
    queue = backlog
    backlog = []
  }
  const next = queue.shift() ?? null
  const noHeadphones = voiceNativeModule()?.isPrivateOutput() === false
  if (next?.auto && !byUser && autoReadNeedsHeadphones() && noHeadphones) {
    logSpeechEvent(`waiting for headphones: ${next.id}`)
    current = take(next)
    piece = 0
    resumeFrom = 0
    hold = { reason: 'unplugged', since: Date.now() }
    emit()
  } else if (next) {
    begin(next)
  } else {
    current = null
    emit()
  }
}

function advance(utterance: Utterance, index: number): void {
  if (index + 1 < utterance.pieces.length) {
    playPiece(utterance, index + 1)
  } else {
    logSpeechEvent(`finished ${utterance.id}`)
    if (!utterance.auto) {
      endOutsideQueue()
    } else if (autoPlay) {
      playNext()
    } else {
      current = null
      emit()
    }
  }
}

function playPiece(utterance: Utterance, index: number, from = 0): void {
  piece = index
  pieceFrom = from
  playPieceRun({
    piece: utterance.pieces[index],
    index,
    count: utterance.pieces.length,
    from,
    // Why: callbacks of an utterance cut off by stop() can still arrive after the next one
    // started, so each one checks it still owns the speaker before advancing.
    owns: () => current === utterance && hold === null,
    onEnd: () => advance(utterance, index)
  })
}

/**
 * The Read button: reads beside the queue, which keeps its place and everything waiting. Pressed
 * again it replaces its own message, never the place it took.
 */
function readOutsideQueue(utterance: Utterance): void {
  if (current?.auto) {
    const from = hold ? resumeFrom : pieceFrom + spokenOffset()
    parked = { utterance: current, piece, from, hold }
  }
  // The message being read, asked for again: it starts over rather than being read twice.
  if (parked?.hold === null && parked.utterance.body === utterance.body) {
    parked = null
  }
  current = null
  stopUtterances()
  begin(utterance)
}

/** Back to the message the Read button cut in on, paused where it was, or to nothing. */
function unpark(): void {
  current = parked?.utterance ?? null
  piece = parked?.piece ?? 0
  resumeFrom = parked?.from ?? 0
  hold =
    parked?.hold ??
    (current && { reason: 'paused', since: Date.now(), ...(autoPlay ? {} : { byAutoRead: true }) })
  parked = null
}

/** The Read button's message is over: the queue goes on as if it had never been there. */
function endOutsideQueue(): void {
  const wasPlaying = parked?.hold === null
  unpark()
  if (wasPlaying && autoPlay) {
    resumeReading('the Read button finished')
  } else if (current === null && autoPlay) {
    playNext()
  } else {
    emit()
  }
}

function start(utterance: Utterance, mode: 'interrupt' | 'queue'): void {
  logSpeechEvent(
    `${mode === 'interrupt' ? 'read' : 'auto-read'} ${utterance.id} (${utterance.pieces.length} pieces)`
  )
  // The Read button also takes its reply out of the queue, where it can wait under another id.
  const other = (queued: Utterance) =>
    queued.id !== utterance.id && (mode === 'queue' || queued.body !== utterance.body)
  queue = queue.filter(other)
  backlog = backlog.filter(other)
  if (mode === 'interrupt') {
    readOutsideQueue(utterance)
    return
  }
  queue.push(utterance)
  if (current === null && hold === null && autoPlay) {
    playNext()
  } else if (autoPlay && holdOverdue(hold, Date.now())) {
    // A pause nobody came back to (often the headset's own) no longer holds new messages.
    resumeReading(`${hold?.reason} too long, a new message came`)
  } else {
    logSpeechEvent(
      `waiting: ${utterance.id} (${hold?.reason ?? (autoPlay ? 'reading' : 'auto-read paused')})`
    )
    emit()
  }
}

/**
 * Reads an agent reply with the device's TTS voice.
 * `interrupt` (the Read button) plays at once, outside the queue; `queue` (auto-read) waits its
 * turn. `intro` (chime, project name) goes first, so a pause follows the name.
 */
export function speakReply(
  id: string,
  markdown: string,
  mode: 'interrupt' | 'queue',
  intro: ReplyIntro | (() => ReplyIntro) = {}
): void {
  const utterance = replyUtterance(id, markdown, mode === 'queue', intro)
  if (utterance) {
    start(utterance, mode)
  }
}

// --- Controls: the notification, the headset and steering-wheel buttons, the Stop pill. ---
// `reason` only labels the app log line, so a stop nobody pressed shows where it came from.

/**
 * Holds the reading where it is. The user's pause or stop is kept until they end it; a call's or
 * unplugged headphones' hold never replaces it.
 */
export function holdReading(reason: Hold['reason'], label: string, byAutoRead = false): void {
  if (current === null) {
    // Nothing to come back to: the focus kept for a call's end can go now.
    if (reason === 'interrupted') {
      stopUtterances()
    }
    return
  }
  if (heldByUser(hold)) {
    return
  }
  resumeFrom = hold === null ? pieceFrom + spokenOffset() : resumeFrom
  hold = { reason, since: Date.now(), ...(byAutoRead ? { byAutoRead } : {}) }
  logSpeechEvent(`${reason}: ${label}`)
  // A call's hold keeps the focus request, so its end is reported.
  if (reason !== 'interrupted') {
    stopUtterances()
  }
  emit()
}

export function pauseReading(reason: string): void {
  holdReading('paused', reason)
}

/** Goes on from the word the reading was cut off at, where the engine reports words. */
export function resumeReading(reason: string): void {
  if (hold === null) {
    return
  }
  logSpeechEvent(`resumed: ${reason}`)
  hold = null
  if (current) {
    emit()
    playPiece(current, piece, resumeFrom)
  } else {
    playNext()
  }
}

/** The middle button: ends a pause, else reads the next message waiting, else the last one again. */
export function playReading(reason: string): void {
  if (hold) {
    resumeReading(reason)
  } else if (current === null && waiting() > 0) {
    logSpeechEvent(`play: ${reason}`)
    playNext(true)
  } else if (current === null && history.length > 0) {
    logSpeechEvent(`repeat: ${reason}`)
    stopUtterances()
    begin(history[history.length - 1])
  }
}

export function nextMessage(reason: string): void {
  // Nothing comes after what the Read button reads: it is outside the queue.
  if (readerState() === 'idle' || current?.auto === false) {
    return
  }
  logSpeechEvent(`next: ${reason}`)
  silence()
  playNext(true)
}

/**
 * Goes to the message before the one being read, which comes back after it; with nothing before
 * it, starts it again, and with nothing being read, reads the last one again.
 */
export function previousMessage(reason: string): void {
  const playing = current
  const target = previousTarget(history, playing)
  if (!target) {
    return
  }
  logSpeechEvent(`previous: ${reason}`)
  if (playing && target !== playing) {
    queue.unshift(playing)
  }
  stopUtterances()
  begin(target)
}

/**
 * The Stop button. The message, from its start, and what waits are kept for Play or Next; new
 * messages are read as they come. With nothing waiting the message is only in Previous's history.
 * Stopping the Read button's message leaves the queue's where it was.
 */
export function stopReading(reason: string): void {
  if (current === null && queue.length === 0) {
    return
  }
  logSpeechEvent(`stopped: ${reason}`)
  if (current?.auto === false) {
    stopUtterances()
    unpark()
  } else {
    toBacklog(queue.length > 0 ? current : null)
    silence()
  }
  emit()
}

// --- What happens to the audio meanwhile. ---

/**
 * The reading ends without the user asking. The queue's message it cut off, from its start, and
 * what waits are kept for Play, like after Stop, so nothing is lost (review, 2026-11-11: the
 * message the Read button cut in on was dropped) and a new message is still read first.
 */
export function endReading(reason: string): void {
  logSpeechEvent(`ended: ${reason}`)
  toBacklog(current?.auto ? current : (parked?.utterance ?? null))
  parked = null
  silence()
  emit()
}

/** Ends only auto-read's part: the queue, and the message being read if it started it. */
export function stopAutoReading(reason: string): void {
  queue = []
  backlog = []
  parked = null
  if (current?.auto) {
    logSpeechEvent(`ended: auto-read: ${reason}`)
    silence()
  }
  emit()
}

export function readerHold(): Hold | null {
  return hold
}

/**
 * Auto-read paused (off): the message being read pauses where it is and new ones wait. Resumed:
 * the reading goes on from there and through everything that waited. What the Read button reads
 * is outside this; the message it cut in on follows once it ends.
 */
export function setAutoPlay(on: boolean): void {
  if (on === autoPlay) {
    return
  }
  autoPlay = on
  if (current?.auto === false) {
    if (on && parked?.hold?.byAutoRead) {
      parked.hold = null
    }
    // Takes over a call or unplug hold, so the reading does not go on when that ends.
  } else if (!on && current && !heldByUser(hold)) {
    holdReading('paused', 'auto-read paused', true)
  } else if (on && hold?.byAutoRead) {
    resumeReading('auto-read resumed')
  } else if (on && current === null && hold === null && queue.length > 0) {
    playNext()
  }
  emit()
}

export function useReaderState(): ReaderState {
  return useReported(readerState)
}
