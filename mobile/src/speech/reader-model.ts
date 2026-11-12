import type { ReaderState } from './voice-native-module'

/** Orca Voice fork: the reader's shapes and rules, without its state (`reply-speaker.ts`). */

const HISTORY_LENGTH = 10

/**
 * A pause or stop older than this gives way to the next new message. Headphones with ear
 * detection and some cars press Pause by themselves, and after 10 minutes the headset buttons go
 * back to the music app (`ReadAloudMediaSession.kt`), so such a pause held every later message
 * without a sound (review, 2026-11-11). Auto-read's own pause is not affected.
 */
export const USER_HOLD_EXPIRES_MS = 10 * 60_000

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
  /** Decided when the message starts, so the chime and name follow what was heard last. */
  intro: (() => ReplyIntro) | null
}

export type ReplyIntro = { chime?: boolean; name?: string | null; title?: string | null }

/**
 * Why nothing plays while something is waiting to be read: `paused` by the user until they
 * resume; `stopped` by the user until Play, from the message's start; `interrupted` by a call or
 * dictation and `unplugged` (headphones-only option, the headphones or car went away), both
 * resumed when that ends.
 */
export type Hold = {
  reason: 'paused' | 'stopped' | 'interrupted' | 'unplugged'
  since: number
  /** Made by pausing auto-read, which resuming it ends; the user's own pause stays. */
  byAutoRead?: boolean
}

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

/** Why a new message waits, for the app log. */
export function waitingReason(hold: Hold | null, autoPlay: boolean): string {
  return hold?.reason ?? (autoPlay ? 'reading' : 'auto-read paused')
}

/** The user's pause or stop, kept longer than `USER_HOLD_EXPIRES_MS`. */
export function holdOverdue(hold: Hold | null, now: number): boolean {
  return hold !== null && heldByUser(hold) && now - hold.since > USER_HOLD_EXPIRES_MS
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
    !outsideQueue && canGoPrevious(history, current),
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
 * What Previous plays: the message before `playing`, however long it played (owner, 2026-11-03: a
 * music player's restart after the first seconds only started the message again), or `playing`
 * with nothing before it; with nothing playing, the last one read.
 */
export function previousTarget(
  history: readonly Utterance[],
  playing: Utterance | null
): Utterance | undefined {
  if (playing === null) {
    return history.at(-1)
  }
  const at = history.findIndex((kept) => kept.id === playing.id)
  return at <= 0 ? playing : history[at - 1]
}

/** Whether Previous has a message to go back to. */
export function canGoPrevious(history: readonly Utterance[], current: Utterance | null): boolean {
  if (current === null) {
    // Nothing being read, all read or messages waiting: Previous reads the last one again, like a
    // music player once the album ended (owner's request, 2026-11-01: it was dimmed when idle).
    return history.length > 0
  }
  return history.findIndex((kept) => kept.id === current.id) > 0
}
