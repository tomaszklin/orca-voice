import { useSyncExternalStore } from 'react'
import type { readerReport } from './reader-model'
import { voiceNativeModule, type ReaderState } from './voice-native-module'

/** Orca Voice fork: tells the notification, the headset and the screens what the reader does. */

const listeners = new Set<() => void>()
let reported = ''

/** Told synchronously rather than from a render, so the notification keeps up off screen. */
export function reportReader(report: ReturnType<typeof readerReport>): void {
  const text = JSON.stringify(report)
  if (text !== reported) {
    reported = text
    voiceNativeModule()?.setReaderState(...report)
  }
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useReported(state: () => ReaderState): ReaderState {
  return useSyncExternalStore(subscribe, state)
}
