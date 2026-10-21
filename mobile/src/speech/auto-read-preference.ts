import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_AUTO_READ_REPLIES,
  loadAutoReadReplies,
  saveAutoReadReplies
} from '../storage/speech-preferences'
import { stopSpeaking } from './reply-speaker'

// One per-device value shared by Settings (writer) and the host list (reader), so a toggle
// takes effect on the list without a remount.
let enabled = DEFAULT_AUTO_READ_REPLIES
let loadStarted = false
let changedBeforeLoad = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function ensureLoaded(): void {
  if (loadStarted) {
    return
  }
  loadStarted = true
  void loadAutoReadReplies().then((stored) => {
    // Why: a toggle made before the read finished is newer than what storage holds.
    if (!changedBeforeLoad && stored !== enabled) {
      enabled = stored
      emit()
    }
  })
}

export function useAutoReadRepliesPreference(): {
  autoRead: boolean
  setAutoRead: (next: boolean) => void
} {
  useEffect(ensureLoaded, [])
  const autoRead = useSyncExternalStore(subscribe, () => enabled)
  const setAutoRead = useCallback((next: boolean) => {
    changedBeforeLoad = true
    enabled = next
    emit()
    if (!next) {
      stopSpeaking('auto-read switched off')
    }
    void saveAutoReadReplies(next).catch(() => undefined)
  }, [])
  return { autoRead, setAutoRead }
}
