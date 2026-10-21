import { useSyncExternalStore } from 'react'
import { stopSpeaking } from './reply-speaker'
import { logSpeechEvent } from './speech-diagnostics'
import { voiceNativeModule } from './voice-native-module'

/**
 * Orca Voice fork: a temporary mute of auto-read, from the reading notification's button or the
 * Read aloud settings (owner's request, 2026-10-21). It leaves the auto-read setting alone and
 * lives only in memory, so a restart of Orca always comes back unmuted. Read buttons still speak.
 */
let muted = false
const listeners = new Set<() => void>()

export function isAutoReadMuted(): boolean {
  return muted
}

export function setAutoReadMuted(next: boolean): void {
  if (next === muted) {
    return
  }
  muted = next
  logSpeechEvent(next ? 'auto-read muted' : 'auto-read unmuted')
  if (next) {
    stopSpeaking('auto-read muted')
  }
  voiceNativeModule()?.setMuted(next)
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAutoReadMuted(): boolean {
  return useSyncExternalStore(subscribe, () => muted)
}
