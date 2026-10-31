import { useSyncExternalStore } from 'react'
import { playPieceRun } from './piece-player'
import { logSpeechEvent } from './speech-diagnostics'
import { spokenOffset, stopUtterances } from './tts-engine'
import {
  heldByUser,
  previousTarget,
  readerReport,
  readingState,
  remembered,
  type Hold,
  type Parked,
  type Utterance
} from './reader-model'
import { replyUtterance, type ReplyIntro } from './reply-pieces'
import { voiceNativeModule, type ReaderState } from './voice-native-module'

/**
 * Said before a message (auto-read): a chime, then the project name, each a piece of its own.
 * `title` names the message in the notification and on a car's display.
 */
export type { ReplyIntro } from './reply-pieces'

let queue: Utterance[] = []
let current: Utterance | null = null
/** The piece of `current` being read, where a resume starts again. */
let piece = 0
// Where in its piece the current utterance starts, and where a resume goes on from.
let pieceFrom = 0
let resumeFrom = 0
let startedAt = 0
let hold: Hold | null = null
/** The queue's message the Read button cut in on; it goes on once that one ends. */
let parked: Parked | null = null
/** Messages auto-read read lately, oldest first. */
let history: Utterance[] = []
let headphonesOnly = false
// Off while auto-read is paused: nothing starts by itself, new messages wait for Play or Next.
let autoPlay = true
const listeners = new Set<() => void>()

function readerState(): ReaderState {
  return readingState(current, hold, queue.length)
}

let reported = ''

function emit(): void {
  // Told synchronously rather than from a render, so the notification keeps up off screen.
  const state = readerReport(current, hold, queue.length, parked !== null, history)
  const report = JSON.stringify(state)
  if (report !== reported) {
    reported = report
    voiceNativeModule()?.setReaderState(...state)
  }
  for (const listener of listeners) {
    listener()
  }
}

function privateOutput(): boolean {
  return voiceNativeModule()?.isPrivateOutput() ?? true
}

/** Makes `utterance` the one being read, from its start. */
function begin(utterance: Utterance): void {
  hold = null
  current = utterance
  // Why: Previous can pick a message that also waits in the queue, which would read it twice.
  queue = queue.filter((queued) => queued.id !== utterance.id)
  startedAt = Date.now()
  // What the Read button reads stays outside the queue, so Previous never goes back to it.
  if (utterance.auto) {
    history = remembered(history, utterance)
  }
  emit()
  playPiece(utterance, 0)
}

/** `byUser`: Play or Next was pressed, which reads what waits through the speaker too. */
function playNext(byUser = false): void {
  current = null
  for (let next = queue.shift(); next; next = queue.shift()) {
    if (next.auto && !byUser && headphonesOnly && !privateOutput()) {
      logSpeechEvent(`skipped ${next.id}: no headphones`)
      continue
    }
    begin(next)
    return
  }
  emit()
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
  hold = parked?.hold ?? (current && { reason: 'paused', since: Date.now() })
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
  queue = queue.filter(
    (queued) => queued.id !== utterance.id && (mode === 'queue' || queued.body !== utterance.body)
  )
  if (mode === 'interrupt') {
    readOutsideQueue(utterance)
    return
  }
  queue.push(utterance)
  if (current === null && hold === null && autoPlay) {
    playNext()
  } else {
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
  intro: ReplyIntro = {}
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
export function holdReading(reason: Hold['reason'], label: string): void {
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
  if (hold === null) {
    resumeFrom = pieceFrom + spokenOffset()
  }
  hold = { reason, since: Date.now() }
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
  } else if (current === null && queue.length > 0) {
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
  hold = null
  current = null
  stopUtterances()
  playNext(true)
}

/**
 * Starts the message again, or — pressed within its first seconds, or with nothing being read —
 * goes to the one before it; the one that was cut off comes back after it.
 */
export function previousMessage(reason: string): void {
  const playing = current
  // A stopped message is back at its start, however long ago it began.
  const playedFor = hold?.reason === 'stopped' ? 0 : Date.now() - startedAt
  const target = previousTarget(history, playing, playedFor)
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
 * The Stop button, which like a player's keeps the queue: the message goes back to its start, and
 * it and what waits wait for Play. With nothing waiting the reader is simply idle, so new messages
 * are read as they come. Stopping the Read button's message leaves the queue's where it was.
 */
export function stopReading(reason: string): void {
  if (current === null || hold?.reason === 'stopped') {
    return
  }
  logSpeechEvent(`stopped: ${reason}`)
  stopUtterances()
  if (!current.auto) {
    unpark()
  } else if (queue.length > 0) {
    piece = 0
    resumeFrom = 0
    hold = { reason: 'stopped', since: Date.now() }
  } else {
    current = null
    hold = null
  }
  emit()
}

// --- What happens to the audio meanwhile. ---

/** The reading ends without the user asking; what waits goes on with Play or the next message. */
export function endReading(reason: string): void {
  logSpeechEvent(`ended: ${reason}`)
  parked = null
  current = null
  hold = null
  stopUtterances()
  emit()
}

/** Ends only auto-read's part: the queue, and the message being read if it started it. */
export function stopAutoReading(reason: string): void {
  queue = []
  parked = null
  if (current?.auto) {
    endReading(`auto-read: ${reason}`)
  } else {
    emit()
  }
}

/** From the Read aloud settings: auto-read only through headphones or a car. */
export function setAutoReadNeedsHeadphones(on: boolean): void {
  headphonesOnly = on
}

export function autoReadNeedsHeadphones(): boolean {
  return headphonesOnly
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
    if (on && parked?.hold?.reason === 'paused') {
      parked.hold = null
    }
    // Takes over a call or unplug hold, so the reading does not go on when that ends.
  } else if (!on && current && !heldByUser(hold)) {
    holdReading('paused', 'auto-read paused')
  } else if (on && hold?.reason === 'paused') {
    resumeReading('auto-read resumed')
  } else if (on && current === null && hold === null && queue.length > 0) {
    playNext()
  }
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useReaderState(): ReaderState {
  return useSyncExternalStore(subscribe, readerState)
}
