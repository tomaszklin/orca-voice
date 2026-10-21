import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_READ_SCOPE,
  loadReadScope,
  saveReadScope,
  type ReadScope
} from '../storage/speech-preferences'

// Orca Voice fork: which agent messages auto-read speaks. One per-device value shared by the
// settings screen (writer) and the auto-reader (reader).
let scope: ReadScope = DEFAULT_READ_SCOPE
let loadStarted = false
let changed = false
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

export function useReadScopePreference(): {
  readScope: ReadScope
  setReadScope: (next: ReadScope) => void
} {
  useEffect(() => {
    if (loadStarted) {
      return
    }
    loadStarted = true
    void loadReadScope().then((stored) => {
      if (!changed && stored !== scope) {
        scope = stored
        emit()
      }
    })
  }, [])
  const readScope = useSyncExternalStore(subscribe, () => scope)
  const setReadScope = useCallback((next: ReadScope) => {
    changed = true
    scope = next
    emit()
    void saveReadScope(next).catch(() => undefined)
  }, [])
  return { readScope, setReadScope }
}
