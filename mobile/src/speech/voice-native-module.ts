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

export type ReaderState = 'idle' | 'reading' | 'paused'

/** `ReadAloudControls` in the module. */
export type ReaderControl = 'stop' | 'previous' | 'pause' | 'play' | 'next' | 'repeat'

export type TileAddResult = 'added' | 'already-added' | 'not-added' | 'unsupported' | 'error'

export type VoiceNativeModule = {
  start(title: string, text: string, tickMs: number): boolean
  stop(): boolean
  isRunning(): boolean
  /** `language`: primary subtag of a voice to read this one in; null for the reading voice. */
  speak(id: string, text: string, language: string | null): boolean
  /**
   * The phone's guess at each text's language (Android 10+), null where it has none. Synchronous:
   * one call per message, before it is read.
   */
  detectLanguages(texts: string[]): ({ language: string; confidence: number } | null)[]
  /** Plays the two-note chime as one utterance, with the speech's audio attributes and focus. */
  chime(id: string): boolean
  stopSpeech(): void
  /** Where the word being read in utterance `id` starts; 0 when the engine reports no words. */
  spokenOffset(id: string): number
  /**
   * `phoneRate`: the rate the phone's text-to-speech settings give, 1 = normal. `language`: BCP 47
   * tag of the voice the reader last read with, null before its engine first started.
   */
  getSpeechOptions(): (SpeechOptions & { phoneRate: number; language: string | null }) | null
  setSpeechOptions(rate: number | null, voice: string | null): boolean
  /** Null when the engine did not start. */
  getVoices(): Promise<NativeVoiceList | null>
  /** The phone's text-to-speech settings: engine, more voices to download. */
  openTtsSettings(): boolean
  /** What the notification's speaker button and the Quick Settings tile show. */
  setMuted(muted: boolean): void
  /**
   * The reader's state: picks the notification's buttons and text (`status`), and holds the
   * headset and steering-wheel buttons while not idle; `title` is what a car's display shows.
   */
  setReaderState(
    state: ReaderState,
    title: string | null,
    status: string | null,
    canRepeat: boolean,
    canPrevious: boolean,
    canNext: boolean
  ): void
  /** Whether sound goes to headphones, a car or the like rather than the phone's own speaker. */
  isPrivateOutput(): boolean
  /** Android's "Add tile to Quick Settings?" prompt (Android 13+). */
  requestAddTile(): Promise<TileAddResult>
  /** Starts downloading an update and opening the installer; false when it could not start. */
  installUpdate(url: string): boolean
  addListener(event: 'onTick' | 'onMuteToggle', listener: () => void): { remove(): void }
  /** The notification's and the headset's reading buttons. */
  addListener(
    event: 'onReaderControl',
    listener: (payload: { action: ReaderControl }) => void
  ): { remove(): void }
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
