import type { ReaderState } from './voice-native-module'

/** Orca Voice fork: the reader's shapes and rules, without its state (`reply-speaker.ts`). */

// Like a music player: Previous this soon after a message started goes to the one before it,
// later it starts the message again.
export const RESTART_AFTER_MS = 3_000
const HISTORY_LENGTH = 10

/** `language`: a sentence run in another language than the reading voice's, read in its own voice. */
export type Piece = { kind: 'chime' } | { kind: 'text'; text: string; language?: string | null }

/**
 * `auto`: queued by auto-read, which the headphones-only option holds back. `kept`: goes into
 * the history Previous and Repeat use; samples from the settings do not. `title` names it in the
 * notification and on a car's display.
 */
export type Utterance = {
  id: string
  pieces: Piece[]
  title: string | null
  auto: boolean
  kept: boolean
}

/**
 * Why nothing plays while something is waiting to be read: `paused` by the user until they
 * resume; `interrupted` by a call or dictation and `unplugged` (headphones-only option, the
 * headphones or car went away), both resumed when that ends.
 */
export type Hold = { reason: 'paused' | 'interrupted' | 'unplugged'; since: number }

const HOLD_STATUS: Record<Hold['reason'], string> = {
  paused: 'Paused',
  interrupted: 'Paused for a call or dictation',
  unplugged: 'Paused until headphones are back'
}

/** The notification's text, e.g. "Reading · OrcaVoice · 2 more waiting"; null while idle. */
export function readerStatus(
  state: ReaderState,
  hold: Hold | null,
  current: Utterance | null,
  waiting: number
): string | null {
  if (state === 'idle') {
    return null
  }
  const parts = [hold ? HOLD_STATUS[hold.reason] : 'Reading']
  if (current?.title) {
    parts.push(current.title)
  }
  if (waiting > 0) {
    parts.push(`${waiting} more waiting`)
  }
  return parts.join(' · ')
}

/** The history once `utterance` starts; a message read again keeps its place in it. */
export function remembered(history: readonly Utterance[], utterance: Utterance): Utterance[] {
  if (!utterance.kept) {
    return [...history]
  }
  const at = history.findIndex((kept) => kept.id === utterance.id)
  return at === -1
    ? [...history, utterance].slice(-HISTORY_LENGTH)
    : history.map((kept, index) => (index === at ? utterance : kept))
}

/**
 * What Previous plays: `playing` again once it has played a while (or with nothing before it),
 * else the message before it — or, with nothing playing, the last one read.
 */
export function previousTarget(
  history: readonly Utterance[],
  playing: Utterance | null,
  playedForMs: number
): Utterance | undefined {
  if (playing === null) {
    return history.at(-1)
  }
  const at = history.findIndex((kept) => kept.id === playing.id)
  return playedForMs >= RESTART_AFTER_MS || at <= 0 ? playing : history[at - 1]
}
