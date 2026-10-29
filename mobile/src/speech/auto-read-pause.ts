import { useSyncExternalStore } from 'react'
import { setAutoPlay } from './reply-speaker'
import { logSpeechEvent } from './speech-diagnostics'
import { voiceNativeModule } from './voice-native-module'

/**
 * Orca Voice fork: pausing auto-read for now, from the reading notification's button, the Quick
 * Settings tile or the Read aloud settings (owner's requests, 2026-10-21 and 2026-10-29). New
 * messages wait in the queue rather than being dropped, and the one being read pauses. It leaves
 * the auto-read setting alone and lives only in memory, so a restart of Orca always resumes it.
 */
let paused = false
const listeners = new Set<() => void>()

export function isAutoReadPaused(): boolean {
  return paused
}

export function setAutoReadPaused(next: boolean): void {
  if (next === paused) {
    return
  }
  paused = next
  logSpeechEvent(next ? 'auto-read paused' : 'auto-read resumed')
  setAutoPlay(!next)
  voiceNativeModule()?.setAutoReadPaused(next)
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAutoReadPaused(): boolean {
  return useSyncExternalStore(subscribe, () => paused)
}
