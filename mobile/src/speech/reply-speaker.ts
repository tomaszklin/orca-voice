import { useSyncExternalStore } from 'react'
import { logSpeechEvent, recordSpeechDiagnostics } from './speech-diagnostics'
import { onUtterancesInterrupted, speakUtterance, stopUtterances } from './tts-engine'
import { splitForSpeech, toSpeechText } from './speech-text'

// A few sentences per piece: when the engine drops one midway (2026-10-21: replies went quiet
// seconds in), only that piece is repeated instead of the rest of the reply being lost.
export const SPEECH_PIECE_LENGTH = 300
const RETRIES_PER_PIECE = 1

type Utterance = { id: string; chunks: string[] }

let queue: Utterance[] = []
let current: Utterance | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function playNext(): void {
  current = queue.shift() ?? null
  emit()
  if (current) {
    playChunk(current, 0, 0)
  }
}

function advance(utterance: Utterance, index: number): void {
  if (index + 1 < utterance.chunks.length) {
    playChunk(utterance, index + 1, 0)
  } else {
    logSpeechEvent(`finished ${utterance.id}`)
    playNext()
  }
}

function playChunk(utterance: Utterance, index: number, attempt: number): void {
  // Why: callbacks of an utterance cut off by stop() can still arrive after the next one
  // started, so each one checks it still owns the speaker before advancing.
  const owns = () => current === utterance
  const piece = `${index + 1}/${utterance.chunks.length}`
  speakUtterance(utterance.chunks[index], {
    onStart: () => {
      recordSpeechDiagnostics({ lastSpokenAt: Date.now() })
      if (index === 0 || attempt > 0) {
        logSpeechEvent(`speaking ${piece}${attempt > 0 ? ' (retry)' : ''}`)
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
      logSpeechEvent(`piece ${piece} failed: ${message}`)
      if (!owns()) {
        return
      }
      if (attempt < RETRIES_PER_PIECE) {
        playChunk(utterance, index, attempt + 1)
      } else {
        advance(utterance, index)
      }
    }
  })
}

/**
 * Reads an agent reply with the device's TTS voice.
 * `interrupt` (the play button) cuts off whatever is playing; `queue` (auto-read) waits its turn.
 */
export function speakReply(id: string, markdown: string, mode: 'interrupt' | 'queue'): void {
  const chunks = splitForSpeech(toSpeechText(markdown), SPEECH_PIECE_LENGTH)
  if (chunks.length === 0) {
    return
  }
  logSpeechEvent(`${mode === 'interrupt' ? 'read' : 'auto-read'} ${id} (${chunks.length} pieces)`)
  if (mode === 'interrupt') {
    queue = []
    current = null
    stopUtterances()
  } else {
    queue = queue.filter((utterance) => utterance.id !== id)
  }
  queue.push({ id, chunks })
  if (!current) {
    playNext()
  }
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
