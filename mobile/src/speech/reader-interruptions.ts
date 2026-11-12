import { heldByUser, type Hold } from './reader-model'
import { autoReadNeedsHeadphones } from './reader-options'
import { endReading, holdReading, readerHold, resumeReading } from './reply-speaker'
import { onAudioEvent } from './tts-engine'
import { voiceNativeModule } from './voice-native-module'

/** Orca Voice fork: what calls, other apps and unplugged headphones do to the reader. */

// A call, dictation or unplugged headphones longer than this end the reading instead of resuming
// it; the message stays for Previous and Play, and what waits keeps waiting.
export const RESUME_WITHIN_MS = 10 * 60_000

// Headphones still there this long after "unplugged" were only a Bluetooth hiccup.
export const UNPLUG_RECHECK_MS = 5_000

function endHold(reason: Hold['reason'], label: string): void {
  const hold = readerHold()
  if (hold?.reason !== reason) {
    return
  }
  if (Date.now() - hold.since > RESUME_WITHIN_MS) {
    endReading(`${label}, too late to go on`)
    return
  }
  resumeReading(label)
}

/**
 * Ends a call's or unplugged headphones' hold that never came back, so later messages are not
 * held forever; auto-read calls it on each poll. The user's own pause or stop stays.
 */
export function expireHolds(now = Date.now()): void {
  const hold = readerHold()
  // Why: a Bluetooth hiccup can report the headphones gone and back without "private-output",
  // which left the reader standing with Resume and Stop (owner, 2026-11-10).
  if (
    hold?.reason === 'unplugged' &&
    now - hold.since >= UNPLUG_RECHECK_MS &&
    now - hold.since <= RESUME_WITHIN_MS &&
    voiceNativeModule()?.isPrivateOutput()
  ) {
    resumeReading('headphones or car are still there')
    return
  }
  if (hold && !heldByUser(hold) && now - hold.since > RESUME_WITHIN_MS) {
    endReading(`${hold.reason}, did not end in time`)
  }
}

onAudioEvent((event, message) => {
  switch (event) {
    case 'interrupted':
      // Another app took the audio for good (music started): like a player, the reading ends.
      endReading(message ?? 'another app took the audio')
      return
    case 'held':
      holdReading('interrupted', message ?? 'a call or dictation took the audio')
      return
    case 'regained':
      endHold('interrupted', 'the call or dictation ended')
      return
    case 'noisy':
      if (autoReadNeedsHeadphones()) {
        holdReading('unplugged', 'headphones or car disconnected')
      }
      return
    case 'private-output':
      endHold('unplugged', 'headphones or car are back')
  }
})
