import * as Speech from 'expo-speech'
import { logSpeechEvent } from './speech-diagnostics'
import { voiceNativeModule, type VoiceNativeModule } from './voice-native-module'

export type UtteranceCallbacks = {
  onStart?: () => void
  onDone?: () => void
  onError?: (error: { message: string }) => void
}

/**
 * Orca Voice fork: one utterance at a time, in expo-speech's shape.
 *
 * On Android it speaks through the fork's own module, voiced as navigation guidance with audio
 * focus held, so music ducks and car head units play it (expo-speech's default attributes were
 * silent in the owner's car while music kept playing, 2026-10-19). Elsewhere, and in a build
 * without the module, it falls back to expo-speech.
 */
const callbacks = new Map<string, UtteranceCallbacks>()
let sequence = 0
let subscribedTo: VoiceNativeModule | null = null
/**
 * What happened to the audio, from the module: `interrupted` (another app took it for good) and
 * `held` (a call or dictation took it for a while) have already stopped the engine; `regained`
 * (they ended), `noisy` (sound is about to move to the phone's speaker), `private-output`
 * (headphones or a car arrived).
 */
export type AudioEvent = 'interrupted' | 'held' | 'regained' | 'noisy' | 'private-output'

const AUDIO_EVENTS: readonly string[] = [
  'interrupted',
  'held',
  'regained',
  'noisy',
  'private-output'
]

let onAudio: (event: AudioEvent, message: string | null) => void = () => undefined

export function onAudioEvent(handler: (event: AudioEvent, message: string | null) => void): void {
  onAudio = handler
  const native = voiceNativeModule()
  if (native !== null) {
    ensureSubscribed(native)
  }
}

function ensureSubscribed(native: VoiceNativeModule): void {
  if (subscribedTo === native) {
    return
  }
  subscribedTo = native
  native.addListener('onSpeech', ({ event, id, message }) => {
    if (AUDIO_EVENTS.includes(event)) {
      if (event === 'interrupted' || event === 'held') {
        callbacks.clear()
      }
      onAudio(event as AudioEvent, message)
      return
    }
    if (event === 'waiting') {
      logSpeechEvent('waiting for the microphone to be free')
      return
    }
    const handlers = callbacks.get(id)
    if (!handlers) {
      return
    }
    if (event === 'start') {
      handlers.onStart?.()
      return
    }
    callbacks.delete(id)
    if (event === 'done') {
      handlers.onDone?.()
    } else {
      handlers.onError?.({ message: message ?? 'text-to-speech failed' })
    }
  })
}

/** Hands one utterance to the module; its progress comes back as `onSpeech` events by id. */
function sendToNative(
  native: VoiceNativeModule,
  handlers: UtteranceCallbacks,
  send: (id: string) => boolean,
  failure: string
): void {
  ensureSubscribed(native)
  sequence += 1
  const id = `utterance-${sequence}`
  callbacks.set(id, handlers)
  if (!send(id)) {
    callbacks.delete(id)
    handlers.onError?.({ message: failure })
  }
}

/** `language`: read with a voice for it instead of the reading voice (a sentence in English). */
export function speakUtterance(
  text: string,
  handlers: UtteranceCallbacks,
  language: string | null = null
): void {
  const native = voiceNativeModule()
  if (native === null) {
    Speech.speak(text, { ...handlers, language: language ?? undefined })
    return
  }
  sendToNative(
    native,
    handlers,
    (id) => native.speak(id, text, language),
    'text-to-speech is not available'
  )
}

/** The short chime before an auto-read message; without the module it is skipped. */
export function playChime(handlers: UtteranceCallbacks): void {
  const native = voiceNativeModule()
  if (native === null) {
    handlers.onDone?.()
    return
  }
  sendToNative(native, handlers, (id) => native.chime(id), 'the chime could not play')
}

export function stopUtterances(): void {
  const native = voiceNativeModule()
  if (native === null) {
    void Speech.stop()
    return
  }
  // Stopped utterances report no `done`; the speaker's queue already moved on without them.
  callbacks.clear()
  native.stopSpeech()
}
