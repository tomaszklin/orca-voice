import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UtteranceCallbacks } from './tts-engine'

const spoken: { text: string; handlers: UtteranceCallbacks }[] = []

vi.mock('./tts-engine', () => ({
  speakUtterance: (text: string, handlers: UtteranceCallbacks) => spoken.push({ text, handlers }),
  stopUtterances: vi.fn()
}))

const { speakReply, stopSpeaking } = await import('./reply-speaker')

const sentence = (n: number) => `Sentence number ${n} is long enough to fill some of a piece.`
const reply = Array.from({ length: 12 }, (_, i) => sentence(i + 1)).join(' ')

function last() {
  return spoken[spoken.length - 1]
}

describe('speakReply', () => {
  beforeEach(() => {
    stopSpeaking()
    spoken.length = 0
  })

  it('reads a long reply in pieces, one after another', () => {
    speakReply('a', reply, 'queue')
    while (last().handlers.onDone) {
      const before = spoken.length
      last().handlers.onDone?.()
      if (spoken.length === before) {
        break
      }
    }
    expect(spoken.length).toBeGreaterThan(1)
    expect(spoken.every(({ text }) => text.length <= 300)).toBe(true)
    expect(spoken.map(({ text }) => text).join(' ')).toBe(reply)
  })

  it('repeats a piece the engine dropped, then moves on if it fails again', () => {
    speakReply('a', reply, 'queue')
    const first = last().text
    last().handlers.onError?.({ message: 'text-to-speech failed (-7)' })
    expect(last().text).toBe(first)
    last().handlers.onError?.({ message: 'text-to-speech failed (-7)' })
    expect(last().text).not.toBe(first)
    expect(spoken).toHaveLength(3)
  })

  it('ignores callbacks of a reply that was stopped', () => {
    speakReply('a', reply, 'queue')
    const stale = last().handlers
    stopSpeaking('test')
    stale.onError?.({ message: 'text-to-speech was stopped by the system' })
    stale.onDone?.()
    expect(spoken).toHaveLength(1)
  })
})
