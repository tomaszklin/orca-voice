import type { ReaderState } from './voice-native-module'

/** Orca Voice fork: the reader's shapes and rules, without its state (`reply-speaker.ts`). */

// Like a music player: Previous this soon after a message started goes to the one before it,
// later it starts the message again.
export const RESTART_AFTER_MS = 3_000
const HISTORY_LENGTH = 10

/** `language`: a sentence run in another language than the reading voice's, read in its own voice. */
export type Piece = { kind: 'chime' } | { kind: 'text'; text: string; language?: string | null }

/**
 * `auto`: queued by auto-read, which the headphones-only option holds back; otherwise the Read
 * button's, which stays outside the queue. `body`: the speech text without the intro, since the
 * same reply reaches the reader under different ids (the Read button, auto-read's feed, its final
 * reply). `title` names it in the notification and on a car's display.
 */
export type Utterance = {
  id: string
  pieces: Piece[]
  title: string | null
  auto: boolean
  body: string
}

/**
 * Why nothing plays while something is waiting to be read: `paused` by the user until they
 * resume; `stopped` by the user until Play, from the message's start; `interrupted` by a call or
 * dictation and `unplugged` (headphones-only option, the headphones or car went away), both
 * resumed when that ends.
 */
export type Hold = { reason: 'paused' | 'stopped' | 'interrupted' | 'unplugged'; since: number }

/** The queue's message the Read button cut in on. `hold` is null when it was playing. */
export type Parked = { utterance: Utterance; piece: number; from: number; hold: Hold | null }

const HOLD_STATUS: Record<Hold['reason'], string> = {
  paused: 'Paused',
  stopped: 'Stopped',
  interrupted: 'Paused for a call or dictation',
  unplugged: 'Paused until headphones are back'
}

/** A hold only the user ends; calls and unplugged headphones leave it as it is. */
export function heldByUser(hold: Hold | null): boolean {
  return hold?.reason === 'paused' || hold?.reason === 'stopped'
}

/**
 * `stopped`: Play is needed, either after the Stop button or for messages waiting with none being
 * read (auto-read paused, or the reading ended by itself). Only `reading` and `paused` can stop.
 */
export function readingState(
  current: Utterance | null,
  hold: Hold | null,
  waiting: number
): ReaderState {
  if (current === null) {
    return waiting > 0 ? 'stopped' : 'idle'
  }
  if (hold === null) {
    return 'reading'
  }
  return hold.reason === 'stopped' ? 'stopped' : 'paused'
}

/**
 * The notification's second line under "Auto-read active" or "paused", e.g. "Reading · OrcaVoice ·
 * 2 more waiting", or "2 waiting" with no message of the queue being read; null while idle.
 */
export function readerStatus(
  state: ReaderState,
  hold: Hold | null,
  current: Utterance | null,
  waiting: number
): string | null {
  if (state === 'idle') {
    return null
  }
  const parts = hold ? [HOLD_STATUS[hold.reason]] : current ? ['Reading'] : []
  if (current?.title) {
    parts.push(current.title)
  }
  if (waiting > 0) {
    parts.push(current?.auto ? `${waiting} more waiting` : `${waiting} waiting`)
  }
  return parts.join(' · ') || null
}

/**
 * The arguments of `setReaderState`. What the Read button reads stays outside the queue, so it
 * offers neither Previous nor Next; the message it cut in on still counts as waiting.
 */
export function readerReport(
  current: Utterance | null,
  hold: Hold | null,
  queued: number,
  hasParked: boolean,
  history: readonly Utterance[]
) {
  const state = readingState(current, hold, queued)
  const outsideQueue = current?.auto === false
  return [
    state,
    current?.title ?? null,
    readerStatus(state, hold, current, queued + (hasParked ? 1 : 0)),
    history.length > 0,
    !outsideQueue && canGoPrevious(history, current, queued),
    !outsideQueue && queued > 0,
    outsideQueue
  ] as const
}

/** The history once `utterance` starts; a message read again keeps its place in it. */
export function remembered(history: readonly Utterance[], utterance: Utterance): Utterance[] {
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

/** Whether Previous has a message to go back to; while idle the notification's Play repeats. */
export function canGoPrevious(
  history: readonly Utterance[],
  current: Utterance | null,
  waiting: number
): boolean {
  if (current === null) {
    // Messages wait while auto-read is paused; Previous reads the last one again.
    return waiting > 0 && history.length > 0
  }
  return history.findIndex((kept) => kept.id === current.id) > 0
}
