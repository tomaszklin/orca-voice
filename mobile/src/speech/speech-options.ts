import { useCallback, useEffect, useState } from 'react'
import { speakReply } from './reply-speaker'
import { voiceNativeModule, type NativeVoiceList, type SpeechOptions } from './voice-native-module'

const NO_OPTIONS: SpeechOptions = { rate: null, voice: null }
export const VOICE_SAMPLE = 'Test czytania odpowiedzi. Test reading replies aloud.'

export function speakVoiceSample(): void {
  speakReply('settings-test', VOICE_SAMPLE, 'interrupt')
}

/**
 * Orca Voice fork: reading speed and voice, kept by the native module so the first reading after
 * a restart already uses them. `available` is false without the module (other platforms).
 */
export function useSpeechOptions(): {
  available: boolean
  options: SpeechOptions
  /** Undefined while loading, null when the engine did not start. */
  voices: NativeVoiceList | null | undefined
  setOptions: (next: SpeechOptions) => void
  openPhoneSettings: () => void
} {
  const native = voiceNativeModule()
  const [options, setOptionsState] = useState<SpeechOptions>(
    () => native?.getSpeechOptions() ?? NO_OPTIONS
  )
  const [voices, setVoices] = useState<NativeVoiceList | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    void native
      ?.getVoices()
      .catch(() => null)
      .then((list) => {
        if (live) {
          setVoices(list)
        }
      })
    return () => {
      live = false
    }
  }, [native])

  const setOptions = useCallback(
    (next: SpeechOptions) => {
      native?.setSpeechOptions(next.rate, next.voice)
      setOptionsState(next)
      speakVoiceSample()
    },
    [native]
  )

  const openPhoneSettings = useCallback(() => {
    native?.openTtsSettings()
  }, [native])

  return { available: native !== null, options, voices, setOptions, openPhoneSettings }
}
