import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

/**
 * Orca Voice fork: one per-device choice in AsyncStorage, shared by the settings screen (writer)
 * and the auto-reader (reader). Loaded on first use; a choice made before the load ends wins.
 */
export function createStoredChoice<T extends string>(
  key: string,
  values: readonly T[],
  fallback: T
): () => { value: T; setValue: (next: T) => void } {
  let value = fallback
  let loadStarted = false
  let changed = false
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of listeners) {
      listener()
    }
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  const stored = (raw: string | null): T | null => values.find((option) => option === raw) ?? null

  return function useStoredChoice() {
    useEffect(() => {
      if (loadStarted) {
        return
      }
      loadStarted = true
      void AsyncStorage.getItem(key).then(
        (raw) => {
          const loaded = stored(raw)
          if (!changed && loaded !== null && loaded !== value) {
            value = loaded
            emit()
          }
        },
        () => undefined
      )
    }, [])
    const current = useSyncExternalStore(subscribe, () => value)
    const setValue = useCallback((next: T) => {
      changed = true
      value = next
      emit()
      void AsyncStorage.setItem(key, next).catch(() => undefined)
    }, [])
    return { value: current, setValue }
  }
}
