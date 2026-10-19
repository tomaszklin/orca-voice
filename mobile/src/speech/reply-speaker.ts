import { useSyncExternalStore } from 'react'
import { recordSpeechDiagnostics } from './speech-diagnostics'
import { speakUtterance, stopUtterances } from './tts-engine'
import { splitForSpeech, toSpeechText } from './speech-text'

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
    playChunk(current, 0)
  }
}

function playChunk(utterance: Utterance, index: number): void {
  // Why: callbacks of an utterance cut off by stop() can still arrive after the next one
  // started, so each one checks it still owns the speaker before advancing.
  const owns = () => current === utterance
  speakUtterance(utterance.chunks[index], {
    onStart: () => recordSpeechDiagnostics({ lastSpokenAt: Date.now() }),
    onDone: () => {
      if (!owns()) {
        return
      }
      if (index + 1 < utterance.chunks.length) {
        playChunk(utterance, index + 1)
      } else {
        playNext()
      }
    },
    onError: (error) => {
      recordSpeechDiagnostics({ lastError: `TTS: ${error?.message ?? 'unknown error'}` })
      if (owns()) {
        playNext()
      }
    }
  })
}

/**
 * Reads an agent reply with the device's TTS voice.
 * `interrupt` (the play button) cuts off whatever is playing; `queue` (auto-read) waits its turn.
 */
export function speakReply(id: string, markdown: string, mode: 'interrupt' | 'queue'): void {
  const chunks = splitForSpeech(toSpeechText(markdown))
  if (chunks.length === 0) {
    return
  }
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

export function stopSpeaking(): void {
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
