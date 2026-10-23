/**
 * Orca Voice fork: the Android module in `modules/orca-voice-background` — the background reading
 * service and the navigation-voiced TTS. Null on other platforms, in tests, and in a build that
 * does not carry the module.
 */
export type NativeVoice = {
  name: string
  /** BCP 47, e.g. `pl-PL`. */
  language: string
  needsInternet: boolean
  installed: boolean
}

export type NativeVoiceList = {
  voices: NativeVoice[]
  defaultVoice: string | null
  /** What the engine reads in when no voice is chosen. */
  language: string
}

/** `rate` 1 = normal; null rate or voice = the phone's text-to-speech setting. */
export type SpeechOptions = { rate: number | null; voice: string | null }

export type VoiceNativeModule = {
  start(title: string, text: string, tickMs: number): boolean
  stop(): boolean
  isRunning(): boolean
  speak(id: string, text: string): boolean
  stopSpeech(): void
  getSpeechOptions(): SpeechOptions | null
  setSpeechOptions(rate: number | null, voice: string | null): boolean
  /** Null when the engine did not start. */
  getVoices(): Promise<NativeVoiceList | null>
  /** The phone's text-to-speech settings: engine, more voices to download. */
  openTtsSettings(): boolean
  /** What the notification's Mute button shows. */
  setMuted(muted: boolean): void
  /** Starts downloading an update and opening the installer; false when it could not start. */
  installUpdate(url: string): boolean
  addListener(event: 'onTick' | 'onMuteToggle', listener: () => void): { remove(): void }
  addListener(
    event: 'onSpeech',
    listener: (payload: { event: string; id: string; message: string | null }) => void
  ): { remove(): void }
}

let nativeModule: VoiceNativeModule | null | undefined

export function voiceNativeModule(): VoiceNativeModule | null {
  if (nativeModule === undefined) {
    nativeModule = null
    try {
      // Both required lazily, so suites that reach this file through the chat or the bridge never
      // load React Native's Flow sources or the native module system.
      // oxlint-disable-next-line typescript/no-require-imports
      const { Platform } = require('react-native') as { Platform: { OS: string } }
      if (Platform.OS === 'android') {
        // oxlint-disable-next-line typescript/no-require-imports
        const core = require('expo-modules-core') as {
          requireOptionalNativeModule<T>(name: string): T | null
        }
        nativeModule = core.requireOptionalNativeModule<VoiceNativeModule>('OrcaVoiceBackground')
      }
    } catch {
      nativeModule = null
    }
  }
  return nativeModule
}
