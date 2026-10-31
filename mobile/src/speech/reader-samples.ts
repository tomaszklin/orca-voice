import { playAside } from './piece-player'
import type { Piece } from './reader-model'
import { replyPieces } from './reply-pieces'
import { pauseReading } from './reply-speaker'
import { stopUtterances } from './tts-engine'

// A sample pauses the reading, which goes on from the word only when Play is pressed.
function playSample(pieces: Piece[]): void {
  pauseReading('settings sample')
  stopUtterances()
  playAside(pieces)
}

/** A sample from the settings: read at once, and left out of Previous and Play. */
export function speakSample(markdown: string): void {
  playSample(replyPieces(markdown))
}

/** The chime alone, played when it is chosen in settings. */
export function playChimeSample(): void {
  playSample([{ kind: 'chime' }])
}
