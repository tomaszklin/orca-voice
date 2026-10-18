import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { AppState, Platform } from 'react-native'
import {
  DEFAULT_BACKGROUND_READING,
  loadBackgroundReading,
  saveBackgroundReading
} from '../storage/speech-preferences'
import { setBackgroundReadingActive } from './background-reading-state'
import { recordSpeechDiagnostics } from './speech-diagnostics'

/**
 * Orca Voice fork: reading replies aloud with the screen off.
 *
 * The native side (`modules/orca-voice-background`) runs a foreground service with a silent,
 * ongoing notification and a partial wake lock, and ticks every few seconds. React Native pauses JS
 * timers in the background, so the auto-reader polls on those ticks instead. While the service
 * runs, the host connection is also told to stay foreground (see `host-logical-client.ts`), or it
 * would drop the relay 30 seconds after the screen goes off.
 */
// Matches the auto-reader's polling interval (`use-auto-read-replies.ts`).
const TICK_MS = 15_000

type NativeBackground = {
  start(title: string, text: string, tickMs: number): boolean
  stop(): boolean
  isRunning(): boolean
  addListener(event: 'onTick', listener: () => void): { remove(): void }
}

let nativeModule: NativeBackground | null | undefined

function background(): NativeBackground | null {
  if (nativeModule === undefined) {
    nativeModule = null
    if (Platform.OS === 'android') {
      try {
        // Required lazily so tests and other platforms never load the native module system.
        // oxlint-disable-next-line typescript/no-require-imports
        const core = require('expo-modules-core') as {
          requireOptionalNativeModule<T>(name: string): T | null
        }
        nativeModule = core.requireOptionalNativeModule<NativeBackground>('OrcaVoiceBackground')
      } catch {
        nativeModule = null
      }
    }
  }
  return nativeModule
}

// --- The user's choice (Settings → Chat UI), persisted. ---

let preferred = DEFAULT_BACKGROUND_READING
let preferenceLoad: Promise<void> | null = null
let preferenceChanged = false
const preferenceListeners = new Set<() => void>()

function emitPreference(): void {
  for (const listener of preferenceListeners) {
    listener()
  }
}

export function useBackgroundReadingPreference(): {
  backgroundReading: boolean
  setBackgroundReading: (next: boolean) => void
} {
  useEffect(() => {
    preferenceLoad ??= loadBackgroundReading().then((stored) => {
      if (!preferenceChanged && stored !== preferred) {
        preferred = stored
        emitPreference()
      }
    })
  }, [])
  const backgroundReading = useSyncExternalStore(
    (listener) => {
      preferenceListeners.add(listener)
      return () => preferenceListeners.delete(listener)
    },
    () => preferred
  )
  const setBackgroundReading = useCallback((next: boolean) => {
    preferenceChanged = true
    preferred = next
    emitPreference()
    void saveBackgroundReading(next).catch(() => undefined)
  }, [])
  return { backgroundReading, setBackgroundReading }
}

/**
 * Runs the service while `wanted` holds and calls `onTick` on each of its ticks. Started from the
 * foreground (where Android allows it) as soon as auto-read and the setting are both on.
 */
export function useBackgroundReadingService(wanted: boolean, onTick: () => void): void {
  useEffect(() => {
    const native = background()
    if (!wanted || native === null) {
      return
    }
    const subscription = native.addListener('onTick', () => {
      recordSpeechDiagnostics({ lastTickAt: Date.now() })
      onTick()
    })
    return () => subscription.remove()
  }, [wanted, onTick])

  // The service itself is kept in line with `wanted` on every change and each time Orca comes back
  // to the screen — the only moment Android lets an app start one. Never stopped on unmount: a
  // remount can happen off screen, where the service could not be started again.
  useEffect(() => {
    const native = background()
    if (native === null) {
      recordSpeechDiagnostics({ service: 'unavailable' })
      return
    }
    const sync = () => {
      if (!wanted) {
        if (native.isRunning()) {
          native.stop()
        }
        setBackgroundReadingActive(false)
        recordSpeechDiagnostics({ service: 'off' })
        return
      }
      if (native.isRunning()) {
        setBackgroundReadingActive(true)
        recordSpeechDiagnostics({ service: 'running' })
        return
      }
      if (AppState.currentState !== 'active') {
        setBackgroundReadingActive(false)
        recordSpeechDiagnostics({ service: 'stopped off screen' })
        return
      }
      const started = native.start('Orca', 'Reading agent replies aloud', TICK_MS)
      setBackgroundReadingActive(started)
      recordSpeechDiagnostics(
        started
          ? { service: 'running', serviceStartedAt: Date.now() }
          : { service: 'refused by Android' }
      )
    }
    sync()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sync()
      }
    })
    return () => subscription.remove()
  }, [wanted])
}
