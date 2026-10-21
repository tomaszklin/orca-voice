import { voiceNativeModule } from './voice-native-module'

/**
 * Orca Voice fork: the phone's own speech recognition, the voice typing the keyboard's mic opens.
 * Resolves with the recognised text, or null when cancelled or the phone has none.
 */
export function recognizeWithSystemDictation(): Promise<string | null> {
  const native = voiceNativeModule()
  return native ? native.recognizeSpeech().catch(() => null) : Promise.resolve(null)
}

export function systemDictationAvailable(): boolean {
  return voiceNativeModule() !== null
}
