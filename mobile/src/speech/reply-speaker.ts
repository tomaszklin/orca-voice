import { useSyncExternalStore } from 'react'
import { logSpeechEvent, recordSpeechDiagnostics } from './speech-diagnostics'
import {
  onUtterancesInterrupted,
  playChime,
  speakUtterance,
  stopUtterances,
  type UtteranceCallbacks
} from './tts-engine'
import { splitForSpeech, toSpeechText } from './speech-text'
import { voiceNativeModule } from './voice-native-module'

// A few sentences per piece: when the engine drops one midway (2026-10-21: replies went quiet
// seconds in), only that piece is repeated instead of the rest of the reply being lost.
export const SPEECH_PIECE_LENGTH = 300
const RETRIES_PER_PIECE = 1

/** Said before a message (auto-read): a chime, then the project name, each a piece of its own. */
export type ReplyIntro = { chime?: boolean; name?: string | null }

type Piece = { kind: 'chime' } | { kind: 'text'; text: string }

type Utterance = { id: string; pieces: Piece[] }

let queue: Utterance[] = []
let current: Utterance | null = null
const listeners = new Set<() => void>()

let reportedBusy = false

function emit(): void {
  // Told synchronously rather than from a render, so the notification's Stop keeps up off screen.
  const busy = current !== null
  if (busy !== reportedBusy) {
    reportedBusy = busy
    voiceNativeModule()?.setSpeaking(busy)
  }
  for (const listener of listeners) {
    listener()
  }
}

function playNext(): void {
  current = queue.shift() ?? null
  emit()
  if (current) {
    playPiece(current, 0, 0)
  }
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
  const owns = () => current === utterance
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
  const piece = utterance.pieces[index]
  if (piece.kind === 'chime') {
    playChime(handlers)
  } else {
    speakUtterance(piece.text, handlers)
  }
}

function start(id: string, pieces: Piece[], mode: 'interrupt' | 'queue'): void {
  logSpeechEvent(`${mode === 'interrupt' ? 'read' : 'auto-read'} ${id} (${pieces.length} pieces)`)
  if (mode === 'interrupt') {
    queue = []
    current = null
    stopUtterances()
  } else {
    queue = queue.filter((utterance) => utterance.id !== id)
  }
  queue.push({ id, pieces })
  if (!current) {
    playNext()
  }
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
  const pieces: Piece[] = splitForSpeech(toSpeechText(markdown), SPEECH_PIECE_LENGTH).map(
    (text) => ({ kind: 'text', text })
  )
  if (pieces.length === 0) {
    return
  }
  if (intro.name) {
    pieces.unshift({ kind: 'text', text: `${intro.name}.` })
  }
  if (intro.chime) {
    pieces.unshift({ kind: 'chime' })
  }
  start(id, pieces, mode)
}

/** The chime alone, played when it is chosen in settings. */
export function playChimeSample(): void {
  start('chime-sample', [{ kind: 'chime' }], 'interrupt')
}

// Like a music player: dictation or a call ends the reading rather than talking over it.
onUtterancesInterrupted((reason) => stopSpeaking(reason))

/** `reason` only labels the reader log, so a stop nobody pressed shows where it came from. */
export function stopSpeaking(reason = 'stop'): void {
  if (current || queue.length > 0) {
    logSpeechEvent(`stopped: ${reason}`)
  }
  queue = []
  current = null
  stopUtterances()
  emit()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The id of the reply being read right now, or null when the speaker is idle. */
export function useSpeakingReplyId(): string | null {
  return useSyncExternalStore(subscribe, () => current?.id ?? null)
}
