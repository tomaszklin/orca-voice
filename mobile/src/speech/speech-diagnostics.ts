/**
 * The reader's steps, in the app log (`adb logcat`), for when a phone stays silent. Orca Voice
 * fork: the Read aloud settings showed them until build 33; the owner no longer needs that.
 */
export function logSpeechEvent(event: string): void {
  console.info(`[read-aloud] ${event}`)
}
