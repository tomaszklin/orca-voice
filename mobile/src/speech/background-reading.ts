import { useCallback, useEffect } from 'react'
import { AppState } from 'react-native'
import {
  BACKGROUND_READING_KEY,
  DEFAULT_BACKGROUND_READING,
  type StoredFlag
} from '../storage/speech-preferences'
import { isAutoReadPaused, setAutoReadPaused } from './auto-read-pause'
import { setBackgroundReadingActive } from './background-reading-state'
import { logSpeechEvent } from './speech-diagnostics'
import { createStoredChoice } from './stored-choice'
import { voiceNativeModule } from './voice-native-module'

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

const background = voiceNativeModule

// --- The user's choice (Settings → Chat UI), persisted. ---

const useBackgroundReadingChoice = createStoredChoice<StoredFlag>(
  BACKGROUND_READING_KEY,
  ['true', 'false'],
  DEFAULT_BACKGROUND_READING
)

// Why: isRunning() stays false until the service has started, which a stop must not wait for.
let startRequested = false

export function useBackgroundReadingPreference(): {
  backgroundReading: boolean
  setBackgroundReading: (next: boolean) => void
} {
  const { value, setValue } = useBackgroundReadingChoice()
  const setBackgroundReading = useCallback(
    (next: boolean) => setValue(next ? 'true' : 'false'),
    [setValue]
  )
  return { backgroundReading: value === 'true', setBackgroundReading }
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
    const subscription = native.addListener('onTick', onTick)
    // The notification's auto-read pause; the reading buttons go through `reader-controls.ts`,
    // which works without the service too.
    const pauseButton = native.addListener('onAutoReadToggle', () =>
      setAutoReadPaused(!isAutoReadPaused())
    )
    return () => {
      subscription.remove()
      pauseButton.remove()
    }
  }, [wanted, onTick])

  // The service itself is kept in line with `wanted` on every change and each time Orca comes back
  // to the screen — the only moment Android lets an app start one. Never stopped on unmount: a
  // remount can happen off screen, where the service could not be started again.
  useEffect(() => {
    const native = background()
    if (native === null) {
      return
    }
    const sync = () => {
      // The notification shows this process's pause, never one a previous run left behind.
      native.setAutoReadPaused(isAutoReadPaused())
      if (!wanted) {
        if (startRequested || native.isRunning()) {
          native.stop()
        }
        startRequested = false
        setBackgroundReadingActive(false)
        return
      }
      if (native.isRunning()) {
        setBackgroundReadingActive(true)
        return
      }
      if (AppState.currentState !== 'active') {
        setBackgroundReadingActive(false)
        return
      }
      const started = native.start(TICK_MS)
      startRequested = started
      setBackgroundReadingActive(started)
      if (!started) {
        logSpeechEvent('background service refused by Android')
      }
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
