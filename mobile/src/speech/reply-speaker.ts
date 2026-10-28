import { useSyncExternalStore } from 'react'
import { logSpeechEvent, recordSpeechDiagnostics } from './speech-diagnostics'
import {
  onAudioEvent,
  playChime,
  speakUtterance,
  stopUtterances,
  type UtteranceCallbacks
} from './tts-engine'
import {
  previousTarget,
  readerStatus,
  remembered,
  type Hold,
  type Piece,
  type Utterance
} from './reader-model'
import { languageSegments } from './language-segments'
import { splitForSpeech, toSpeechText } from './speech-text'
import { voiceNativeModule, type ReaderState } from './voice-native-module'

// A few sentences per piece: when the engine drops one midway (2026-10-21: replies went quiet
// seconds in), only that piece is repeated instead of the rest of the reply being lost.
export const SPEECH_PIECE_LENGTH = 300
const RETRIES_PER_PIECE = 1
// A call, dictation or unplugged headphones longer than this end the reading instead of resuming
// it; the message stays for Repeat.
export const RESUME_WITHIN_MS = 10 * 60_000

/**
 * Said before a message (auto-read): a chime, then the project name, each a piece of its own.
 * `title` names the message in the notification and on a car's display.
 */
export type ReplyIntro = { chime?: boolean; name?: string | null; title?: string | null }

let queue: Utterance[] = []
let current: Utterance | null = null
/** The piece of `current` being read, where a resume starts again. */
let piece = 0
let startedAt = 0
let hold: Hold | null = null
/** Messages read lately, oldest first. */
let history: Utterance[] = []
let headphonesOnly = false
const listeners = new Set<() => void>()

function readerState(): ReaderState {
  if (current === null && queue.length === 0) {
    return 'idle'
  }
  return hold ? 'paused' : 'reading'
}

let reported = ''

function emit(): void {
  // Told synchronously rather than from a render, so the notification keeps up off screen.
  const state = readerState()
  const title = current?.title ?? null
  const status = readerStatus(state, hold, current, queue.length)
  const canRepeat = history.length > 0
  const report = JSON.stringify([state, title, status, canRepeat])
  if (report !== reported) {
    reported = report
    voiceNativeModule()?.setReaderState(state, title, status, canRepeat)
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
  startedAt = Date.now()
  history = remembered(history, utterance)
  emit()
  playPiece(utterance, 0, 0)
}

function playNext(): void {
  current = null
  for (let next = queue.shift(); next; next = queue.shift()) {
    if (next.auto && headphonesOnly && !privateOutput()) {
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
    playPiece(utterance, index + 1, 0)
  } else {
    logSpeechEvent(`finished ${utterance.id}`)
    playNext()
  }
}

function playPiece(utterance: Utterance, index: number, attempt: number): void {
  // Why: callbacks of an utterance cut off by stop() can still arrive after the next one
  // started, so each one checks it still owns the speaker before advancing.
  const owns = () => current === utterance && hold === null
  piece = index
  const position = `${index + 1}/${utterance.pieces.length}`
  const handlers: UtteranceCallbacks = {
    onStart: () => {
      recordSpeechDiagnostics({ lastSpokenAt: Date.now() })
      if (index === 0 || attempt > 0) {
        logSpeechEvent(`speaking ${position}${attempt > 0 ? ' (retry)' : ''}`)
      }
    },
    onDone: () => {
      if (owns()) {
        advance(utterance, index)
      }
    },
    onError: (error) => {
      const message = error?.message ?? 'unknown error'
      recordSpeechDiagnostics({ lastError: `TTS: ${message}` })
      logSpeechEvent(`piece ${position} failed: ${message}`)
      if (!owns()) {
        return
      }
      if (attempt < RETRIES_PER_PIECE) {
        playPiece(utterance, index, attempt + 1)
      } else {
        advance(utterance, index)
      }
    }
  }
  const next = utterance.pieces[index]
  if (next.kind === 'chime') {
    playChime(handlers)
  } else {
    speakUtterance(next.text, handlers, next.language ?? null)
  }
}

function start(utterance: Utterance, mode: 'interrupt' | 'queue'): void {
  logSpeechEvent(
    `${mode === 'interrupt' ? 'read' : 'auto-read'} ${utterance.id} (${utterance.pieces.length} pieces)`
  )
  if (mode === 'interrupt') {
    queue = []
    current = null
    stopUtterances()
    begin(utterance)
    return
  }
  queue = queue.filter((queued) => queued.id !== utterance.id)
  queue.push(utterance)
  if (current === null && hold === null) {
    playNext()
  } else {
    emit()
  }
}

function textPieces(markdown: string): Piece[] {
  return languageSegments(toSpeechText(markdown)).flatMap((segment) =>
    splitForSpeech(segment.text, SPEECH_PIECE_LENGTH).map((text): Piece => ({
      kind: 'text',
      text,
      language: segment.language
    }))
  )
}

/**
 * Reads an agent reply with the device's TTS voice.
 * `interrupt` (the play button) cuts off whatever is playing; `queue` (auto-read) waits its turn.
 * `intro` (chime, project name) goes first, so a pause follows the name.
 */
export function speakReply(
  id: string,
  markdown: string,
  mode: 'interrupt' | 'queue',
  intro: ReplyIntro = {}
): void {
  const pieces = textPieces(markdown)
  if (pieces.length === 0) {
    return
  }
  if (intro.name) {
    pieces.unshift({ kind: 'text', text: `${intro.name}.` })
  }
  if (intro.chime) {
    pieces.unshift({ kind: 'chime' })
  }
  start({ id, pieces, title: intro.title ?? null, auto: mode === 'queue', kept: true }, mode)
}

/** A sample from the settings: read at once, and left out of Previous and Repeat. */
export function speakSample(markdown: string): void {
  start(
    { id: 'sample', pieces: textPieces(markdown), title: null, auto: false, kept: false },
    'interrupt'
  )
}

/** The chime alone, played when it is chosen in settings. */
export function playChimeSample(): void {
  start(
    { id: 'chime-sample', pieces: [{ kind: 'chime' }], title: null, auto: false, kept: false },
    'interrupt'
  )
}

// --- Controls: the notification, the headset and steering-wheel buttons, the Stop pill. ---
// `reason` only labels the reader log, so a stop nobody pressed shows where it came from.

/**
 * Holds the reading where it is. The user's pause is kept until they resume; a call's or
 * unplugged headphones' hold never replaces it.
 */
function holdReading(reason: Hold['reason'], label: string): void {
  if (readerState() === 'idle') {
    // Nothing to come back to: the focus kept for a call's end can go now.
    if (reason === 'interrupted') {
      stopUtterances()
    }
    return
  }
  if (hold?.reason === 'paused') {
    return
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

/** Goes on from the start of the piece that was cut off. */
export function resumeReading(reason: string): void {
  if (hold === null) {
    return
  }
  logSpeechEvent(`resumed: ${reason}`)
  hold = null
  if (current) {
    emit()
    playPiece(current, piece, 0)
  } else {
    playNext()
  }
}

export function nextMessage(reason: string): void {
  if (readerState() === 'idle') {
    return
  }
  logSpeechEvent(`next: ${reason}`)
  hold = null
  current = null
  stopUtterances()
  playNext()
}

/**
 * Starts the message again, or — pressed within its first seconds, or with nothing being read —
 * goes to the one before it; the one that was cut off comes back after it.
 */
export function previousMessage(reason: string): void {
  const playing = current
  const target = previousTarget(history, playing, Date.now() - startedAt)
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

/** The notification's Repeat: the message being read from its start, else the last one read. */
export function repeatLast(reason: string): void {
  const target = current ?? history[history.length - 1]
  if (!target) {
    return
  }
  logSpeechEvent(`repeat: ${reason}`)
  stopUtterances()
  begin(target)
}

export function stopSpeaking(reason = 'stop'): void {
  if (current || queue.length > 0) {
    logSpeechEvent(`stopped: ${reason}`)
  }
  queue = []
  current = null
  hold = null
  stopUtterances()
  emit()
}

// --- What happens to the audio meanwhile. ---

/** From the Read aloud settings: auto-read only through headphones or a car. */
export function setAutoReadNeedsHeadphones(on: boolean): void {
  headphonesOnly = on
}

function endHold(reason: Hold['reason'], label: string): void {
  if (hold?.reason !== reason) {
    return
  }
  if (Date.now() - hold.since > RESUME_WITHIN_MS) {
    stopSpeaking(`${label}, too late to go on`)
    return
  }
  resumeReading(label)
}

/**
 * Ends a call's or unplugged headphones' hold that never came back, so later messages are not
 * held forever; auto-read calls it on each poll. The user's own pause stays.
 */
export function expireHolds(now = Date.now()): void {
  if (hold && hold.reason !== 'paused' && now - hold.since > RESUME_WITHIN_MS) {
    stopSpeaking(`${hold.reason}, did not end in time`)
  }
}

onAudioEvent((event, message) => {
  switch (event) {
    case 'interrupted':
      // Another app took the audio for good (music started): like a player, the reading ends.
      stopSpeaking(message ?? 'another app took the audio')
      return
    case 'held':
      holdReading('interrupted', message ?? 'a call or dictation took the audio')
      return
    case 'regained':
      endHold('interrupted', 'the call or dictation ended')
      return
    case 'noisy':
      if (headphonesOnly) {
        holdReading('unplugged', 'headphones or car disconnected')
      }
      return
    case 'private-output':
      endHold('unplugged', 'headphones or car are back')
  }
})

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The id of the reply being read (or paused) right now, or null when the speaker is idle. */
export function useSpeakingReplyId(): string | null {
  return useSyncExternalStore(subscribe, () => current?.id ?? null)
}

export function useReaderState(): ReaderState {
  return useSyncExternalStore(subscribe, readerState)
}
