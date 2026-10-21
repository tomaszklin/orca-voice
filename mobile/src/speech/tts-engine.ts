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
let onInterrupted: (reason: string) => void = () => undefined

/** Called when another app took the audio (dictation, a call); the engine has already stopped. */
export function onUtterancesInterrupted(handler: (reason: string) => void): void {
  onInterrupted = handler
}

function ensureSubscribed(native: VoiceNativeModule): void {
  if (subscribedTo === native) {
    return
  }
  subscribedTo = native
  native.addListener('onSpeech', ({ event, id, message }) => {
    if (event === 'interrupted') {
      callbacks.clear()
      onInterrupted(message ?? 'another app took the audio')
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

export function speakUtterance(text: string, handlers: UtteranceCallbacks): void {
  const native = voiceNativeModule()
  if (native === null) {
    Speech.speak(text, handlers)
    return
  }
  ensureSubscribed(native)
  sequence += 1
  const id = `utterance-${sequence}`
  callbacks.set(id, handlers)
  if (!native.speak(id, text)) {
    callbacks.delete(id)
    handlers.onError?.({ message: 'text-to-speech is not available' })
  }
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
