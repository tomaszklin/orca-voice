// Silent Node stand-in for expo-speech: tests that reach the reply speaker get a TTS that
// finishes immediately instead of importing the native module.
type SpeechOptions = { onDone?: () => void }

export function speak(_text: string, options?: SpeechOptions): void {
  options?.onDone?.()
}

export async function stop(): Promise<void> {}
