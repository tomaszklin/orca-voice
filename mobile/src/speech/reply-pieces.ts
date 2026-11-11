import { languageSegments } from './language-segments'
import type { Piece, ReplyIntro, Utterance } from './reader-model'
import { splitForSpeech, toSpeechText } from './speech-text'

// Why: the engine can drop an utterance midway; short pieces lose only that piece, retried once.
export const SPEECH_PIECE_LENGTH = 300

export type { ReplyIntro } from './reader-model'

/** A reply as speakable pieces, each run of sentences tagged with its language. */
export function replyPieces(markdown: string): Piece[] {
  return languageSegments(toSpeechText(markdown)).flatMap((segment) =>
    splitForSpeech(segment.text, SPEECH_PIECE_LENGTH).map((text): Piece => ({
      kind: 'text',
      text,
      language: segment.language
    }))
  )
}

function introPieces(intro: ReplyIntro): Piece[] {
  const pieces: Piece[] = []
  if (intro.chime) {
    pieces.push({ kind: 'chime' })
  }
  if (intro.name) {
    pieces.push({ kind: 'text', text: `${intro.name}.` })
  }
  return pieces
}

/**
 * A reply as the reader queues it, or null when nothing in it is read. The intro is read as pieces
 * of its own so a pause follows the project name. Given as a function, it is decided only when the
 * message starts (`withIntro`): a message that waited is introduced after what was heard before it.
 */
export function replyUtterance(
  id: string,
  markdown: string,
  auto: boolean,
  intro: ReplyIntro | (() => ReplyIntro)
): Utterance | null {
  const pieces = replyPieces(markdown)
  if (pieces.length === 0) {
    return null
  }
  const body = pieces.map((part) => (part.kind === 'text' ? part.text : '')).join(' ')
  if (typeof intro === 'function') {
    return { id, pieces, title: null, auto, body, intro }
  }
  return {
    id,
    pieces: [...introPieces(intro), ...pieces],
    title: intro.title ?? null,
    auto,
    body,
    intro: null
  }
}

/** `utterance` as it starts: its intro decided now, once. */
export function withIntro(utterance: Utterance): Utterance {
  if (!utterance.intro) {
    return utterance
  }
  const intro = utterance.intro()
  return {
    ...utterance,
    pieces: [...introPieces(intro), ...utterance.pieces],
    title: intro.title ?? utterance.title,
    intro: null
  }
}
