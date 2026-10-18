import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  DEFAULT_BUILT_IN_PAGE,
  loadBuiltInPage,
  saveBuiltInPage
} from '../storage/speech-preferences'

// Orca Voice fork: whether the shell serves the page bundle built into this APK (which carries the
// chat's Read button) instead of the one the desktop sends. Read by the shell session's effects
// when a screen opens, so a change applies to the next screen opened, not the one on display.
let enabled = DEFAULT_BUILT_IN_PAGE
let loaded: Promise<boolean> | null = null
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

/** The stored choice, read once per process; a toggle made since wins over storage. */
export function readBuiltInPageEnabled(): Promise<boolean> {
  loaded ??= loadBuiltInPage().then((stored) => {
    if (!changed && stored !== enabled) {
      enabled = stored
      emit()
    }
    return enabled
  })
  return loaded.then(() => enabled)
}

export function useBuiltInPagePreference(): {
  builtInPage: boolean
  setBuiltInPage: (next: boolean) => void
} {
  useEffect(() => {
    void readBuiltInPageEnabled()
  }, [])
  const builtInPage = useSyncExternalStore(subscribe, () => enabled)
  const setBuiltInPage = useCallback((next: boolean) => {
    changed = true
    enabled = next
    emit()
    void saveBuiltInPage(next).catch(() => undefined)
  }, [])
  return { builtInPage, setBuiltInPage }
}
