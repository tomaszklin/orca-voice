import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UtteranceCallbacks } from './tts-engine'

const spoken: { text: string; handlers: UtteranceCallbacks }[] = []
const interrupt: { current: (reason: string) => void } = { current: () => undefined }

vi.mock('./tts-engine', () => ({
  speakUtterance: (text: string, handlers: UtteranceCallbacks) => spoken.push({ text, handlers }),
  playChime: (handlers: UtteranceCallbacks) => spoken.push({ text: '(chime)', handlers }),
  stopUtterances: vi.fn(),
  onUtterancesInterrupted: (handler: (reason: string) => void) => {
    interrupt.current = handler
  }
}))

const setSpeaking = vi.fn()
vi.mock('./voice-native-module', () => ({ voiceNativeModule: () => ({ setSpeaking }) }))

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

  it('stops reading, queue included, when another app takes the audio', () => {
    speakReply('a', reply, 'queue')
    speakReply('b', reply, 'queue')
    interrupt.current('another app took the audio')
    last().handlers.onDone?.()
    expect(spoken).toHaveLength(1)
  })

  it('says the project name first, as its own piece, and never alone', () => {
    speakReply('a', 'Done.', 'queue', { name: 'Orca Voice' })
    expect(last().text).toBe('Orca Voice.')
    last().handlers.onDone?.()
    expect(last().text).toBe('Done.')
    stopSpeaking()
    spoken.length = 0
    speakReply('b', '   ', 'queue', { chime: true, name: 'Orca Voice' })
    expect(spoken).toEqual([])
  })

  it('plays the chime before the project name, and moves on when it fails', () => {
    speakReply('a', 'Done.', 'queue', { chime: true, name: 'Orca Voice' })
    expect(last().text).toBe('(chime)')
    last().handlers.onDone?.()
    expect(last().text).toBe('Orca Voice.')
    stopSpeaking()
    spoken.length = 0
    speakReply('b', 'Done.', 'queue', { chime: true })
    last().handlers.onError?.({ message: 'the chime could not play' })
    last().handlers.onError?.({ message: 'the chime could not play' })
    expect(last().text).toBe('Done.')
  })

  it('ignores callbacks of a reply that was stopped', () => {
    speakReply('a', reply, 'queue')
    const stale = last().handlers
    stopSpeaking('test')
    stale.onError?.({ message: 'text-to-speech was stopped by the system' })
    stale.onDone?.()
    expect(spoken).toHaveLength(1)
  })

  it('tells the notification when reading starts and when the queue runs out', () => {
    setSpeaking.mockClear()
    speakReply('a', 'One.', 'queue')
    speakReply('b', 'Two.', 'queue')
    last().handlers.onDone?.()
    last().handlers.onDone?.()
    expect(setSpeaking.mock.calls).toEqual([[true], [false]])
  })
})
