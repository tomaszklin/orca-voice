import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AudioEvent, UtteranceCallbacks } from './tts-engine'

const spoken: { text: string; handlers: UtteranceCallbacks }[] = []
const stopUtterances = vi.fn()
const spokenOffset = vi.fn(() => 0)
const audio: { current: (event: AudioEvent, message: string | null) => void } = {
  current: () => undefined
}

vi.mock('./tts-engine', () => ({
  speakUtterance: (text: string, handlers: UtteranceCallbacks) => spoken.push({ text, handlers }),
  playChime: (handlers: UtteranceCallbacks) => spoken.push({ text: '(chime)', handlers }),
  stopUtterances: () => stopUtterances(),
  spokenOffset: () => spokenOffset(),
  onAudioEvent: (handler: (event: AudioEvent, message: string | null) => void) => {
    audio.current = handler
  }
}))

const native = {
  setReaderState: vi.fn(),
  isPrivateOutput: vi.fn(() => true),
  getSpeechOptions: vi.fn(() => ({ rate: null, voice: null, phoneRate: 1, language: 'en-US' }))
}
vi.mock('./voice-native-module', () => ({ voiceNativeModule: () => native }))

const { RESTART_AFTER_MS, canGoPrevious } = await import('./reader-model')
const { RESUME_WITHIN_MS, expireHolds } = await import('./reader-interruptions')
const { playChimeSample, speakSample } = await import('./reader-samples')
const {
  nextMessage,
  pauseReading,
  playReading,
  previousMessage,
  resumeReading,
  setAutoPlay,
  setAutoReadNeedsHeadphones,
  speakReply,
  stopAutoReading,
  stopReading
} = await import('./reply-speaker')

const sentence = (n: number) => `Sentence number ${n} is long enough to fill some of a piece.`
const reply = Array.from({ length: 12 }, (_, i) => sentence(i + 1)).join(' ')

function last() {
  return spoken[spoken.length - 1]
}

function finishPiece() {
  last().handlers.onDone?.()
}

function lastState() {
  return native.setReaderState.mock.calls.at(-1)?.[0]
}

function lastStatus() {
  return native.setReaderState.mock.calls.at(-1)?.[2]
}

function resetReader() {
  stopReading('test')
  stopAutoReading('test')
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000_000)
  setAutoPlay(true)
  resetReader()
  spoken.length = 0
  stopUtterances.mockClear()
  spokenOffset.mockReturnValue(0)
  setAutoReadNeedsHeadphones(false)
  native.isPrivateOutput.mockReturnValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('speakReply', () => {
  it('reads a long reply in pieces, one after another', () => {
    speakReply('a', reply, 'queue')
    while (last().handlers.onDone) {
      const before = spoken.length
      finishPiece()
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

  it('ends the reading but keeps what waits when another app takes the audio for good', () => {
    speakReply('a', reply, 'queue')
    speakReply('b', 'Second.', 'queue')
    audio.current('interrupted', 'another app took the audio')
    finishPiece()
    expect(spoken).toHaveLength(1)
    expect(lastState()).toBe('stopped')
    speakReply('c', 'Third.', 'queue')
    expect(last().text).toBe('Second.')
    finishPiece()
    expect(last().text).toBe('Third.')
  })

  it('says the project name first, as its own piece, and never alone', () => {
    speakReply('a', 'Done.', 'queue', { name: 'Orca Voice' })
    expect(last().text).toBe('Orca Voice.')
    finishPiece()
    expect(last().text).toBe('Done.')
    resetReader()
    spoken.length = 0
    speakReply('b', '   ', 'queue', { chime: true, name: 'Orca Voice' })
    expect(spoken).toEqual([])
  })

  it('plays the chime before the project name, and moves on when it fails', () => {
    speakReply('a', 'Done.', 'queue', { chime: true, name: 'Orca Voice' })
    expect(last().text).toBe('(chime)')
    finishPiece()
    expect(last().text).toBe('Orca Voice.')
    resetReader()
    spoken.length = 0
    speakReply('b', 'Done.', 'queue', { chime: true })
    last().handlers.onError?.({ message: 'the chime could not play' })
    last().handlers.onError?.({ message: 'the chime could not play' })
    expect(last().text).toBe('Done.')
  })

  it('ignores callbacks of a reply that was stopped', () => {
    speakReply('a', reply, 'queue')
    const stale = last().handlers
    stopReading('test')
    stale.onError?.({ message: 'text-to-speech was stopped by the system' })
    stale.onDone?.()
    expect(spoken).toHaveLength(1)
  })

  it('tells the notification what is read, what waits, and when it is over', () => {
    native.setReaderState.mockClear()
    speakReply('a', 'One.', 'queue', { title: 'OrcaVoice' })
    speakReply('b', 'Two.', 'queue')
    expect(native.setReaderState).toHaveBeenLastCalledWith(
      'reading',
      'OrcaVoice',
      'Reading · OrcaVoice · 1 more waiting',
      true,
      expect.any(Boolean),
      true,
      false
    )
    finishPiece()
    expect(native.setReaderState).toHaveBeenLastCalledWith(
      'reading',
      null,
      'Reading',
      true,
      true,
      false,
      false
    )
    finishPiece()
    expect(native.setReaderState).toHaveBeenLastCalledWith(
      'idle',
      null,
      null,
      true,
      expect.any(Boolean),
      false,
      false
    )
  })
})

describe('reading controls', () => {
  it('pauses and goes on from the piece that was cut off, with new messages waiting', () => {
    speakReply('long', reply, 'queue')
    finishPiece()
    const second = last().text
    pauseReading('test')
    expect(stopUtterances).toHaveBeenCalled()
    expect(lastState()).toBe('paused')
    speakReply('later', 'Later.', 'queue')
    expect(last().text).toBe(second)
    const before = spoken.length
    resumeReading('test')
    expect(spoken).toHaveLength(before + 1)
    expect(last().text).toBe(second)
  })

  it('goes on from the word it was reading, not from the start of the piece', () => {
    speakReply('long', reply, 'queue')
    const first = last().text
    spokenOffset.mockReturnValue(16)
    pauseReading('test')
    spokenOffset.mockReturnValue(0)
    resumeReading('test')
    expect(last().text).toBe(first.slice(16))
    // A second pause counts from where the resumed part began.
    spokenOffset.mockReturnValue(10)
    pauseReading('test')
    resumeReading('test')
    expect(last().text).toBe(first.slice(26))
  })

  it('skips to the next message', () => {
    speakReply('first', reply, 'queue')
    speakReply('second', 'Second.', 'queue')
    nextMessage('test')
    expect(last().text).toBe('Second.')
    nextMessage('test')
    expect(lastState()).toBe('idle')
  })

  it('goes back a message when pressed early, and starts it again when pressed later', () => {
    speakReply('earlier', 'Earlier.', 'queue')
    finishPiece()
    speakReply('now', 'Now.', 'queue')
    previousMessage('test')
    expect(last().text).toBe('Earlier.')
    finishPiece()
    expect(last().text).toBe('Now.')
    vi.setSystemTime(Date.now() + RESTART_AFTER_MS)
    const before = spoken.length
    previousMessage('test')
    expect(spoken).toHaveLength(before + 1)
    expect(last().text).toBe('Now.')
  })

  it('repeats the last message read once the reader is idle', () => {
    speakReply('done', 'Read once.', 'queue')
    finishPiece()
    expect(lastState()).toBe('idle')
    playReading('test')
    expect(last().text).toBe('Read once.')
    finishPiece()
    playReading('test')
    expect(spoken.map(({ text }) => text)).toEqual(['Read once.', 'Read once.', 'Read once.'])
  })

  it('dims Previous on the only message read, and offers it once one came before', () => {
    const first = { id: 'first', pieces: [], title: null, auto: true, body: 'First.' }
    const second = { ...first, id: 'second', body: 'Second.' }
    expect(canGoPrevious([first], first, 0)).toBe(false)
    expect(canGoPrevious([first, second], second, 0)).toBe(true)
  })
})

describe('the Stop button', () => {
  it('keeps the queue: Play starts the message again and reads on', () => {
    speakReply('first', reply, 'queue', { title: 'Orca' })
    speakReply('second', 'Second.', 'queue')
    const start = last().text
    finishPiece()
    stopReading('test')
    expect(stopUtterances).toHaveBeenCalled()
    expect(lastState()).toBe('stopped')
    expect(lastStatus()).toBe('Stopped · Orca · 1 more waiting')
    playReading('test')
    expect(last().text).toBe(start)
    expect(lastState()).toBe('reading')
  })

  it('keeps everything silent until Play, new messages included', () => {
    speakReply('first', 'First.', 'queue')
    speakReply('second', 'Second.', 'queue')
    stopReading('test')
    speakReply('third', 'Third.', 'queue')
    expect(spoken.map(({ text }) => text)).toEqual(['First.'])
    expect(lastStatus()).toBe('Stopped · 2 more waiting')
    playReading('test')
    finishPiece()
    finishPiece()
    expect(spoken.map(({ text }) => text)).toEqual(['First.', 'First.', 'Second.', 'Third.'])
  })

  it('goes idle with nothing waiting, so new messages are read as they come', () => {
    speakReply('only', 'Only.', 'queue')
    stopReading('test')
    expect(lastState()).toBe('idle')
    speakReply('next', 'Next.', 'queue')
    expect(last().text).toBe('Next.')
  })

  it('moves on with Next and goes back with Previous, however long it stood', () => {
    speakReply('first', 'First.', 'queue')
    finishPiece()
    speakReply('second', 'Second.', 'queue')
    speakReply('third', 'Third.', 'queue')
    stopReading('test')
    vi.setSystemTime(Date.now() + RESTART_AFTER_MS * 10)
    previousMessage('test')
    expect(last().text).toBe('First.')
    stopReading('test')
    nextMessage('test')
    expect(last().text).toBe('Second.')
    expect(lastState()).toBe('reading')
  })

  it('does nothing with no message to stop, and survives calls and pausing auto-read', () => {
    speakReply('first', 'First.', 'queue')
    speakReply('second', 'Second.', 'queue')
    stopReading('test')
    audio.current('held', null)
    expireHolds(Date.now() + RESUME_WITHIN_MS + 1)
    setAutoPlay(false)
    setAutoPlay(true)
    stopReading('test')
    expect(lastState()).toBe('stopped')
    expect(spoken).toHaveLength(1)
  })
})

describe('the Read button stays outside the queue', () => {
  it('shows in the notification with neither Previous nor Next, and leaves no trace', () => {
    speakReply('auto', 'Auto.', 'queue')
    finishPiece()
    setAutoPlay(false)
    speakReply('waiting', 'Waiting.', 'queue')
    native.setReaderState.mockClear()
    speakReply('button', 'Button.', 'interrupt')
    expect(native.setReaderState).toHaveBeenLastCalledWith(
      'reading',
      null,
      'Reading · 1 waiting',
      true,
      false,
      false,
      true
    )
    previousMessage('test')
    nextMessage('test')
    expect(last().text).toBe('Button.')
    finishPiece()
    expect(lastState()).toBe('stopped')
    expect(native.setReaderState.mock.calls.at(-1)?.[5]).toBe(true)
    setAutoPlay(true)
    finishPiece()
    playReading('test')
    expect(last().text).toBe('Waiting.')
  })

  it('pauses and goes on from the word', () => {
    speakReply('button', reply, 'interrupt')
    const first = last().text
    spokenOffset.mockReturnValue(16)
    pauseReading('test')
    spokenOffset.mockReturnValue(0)
    expect(lastState()).toBe('paused')
    playReading('test')
    expect(last().text).toBe(first.slice(16))
  })

  it('leaves the message it cut in on where it was, and that goes on from the word', () => {
    speakReply('auto', reply, 'queue')
    speakReply('waiting', 'Waiting.', 'queue')
    const first = last().text
    spokenOffset.mockReturnValue(16)
    speakReply('button', 'Button.', 'interrupt')
    spokenOffset.mockReturnValue(0)
    expect(last().text).toBe('Button.')
    expect(lastStatus()).toBe('Reading · 2 waiting')
    finishPiece()
    expect(last().text).toBe(first.slice(16))
    expect(lastStatus()).toBe('Reading · 1 more waiting')
  })

  it('waits for the end of its message before new ones start', () => {
    speakReply('button', 'Button.', 'interrupt')
    speakReply('auto', 'Auto.', 'queue')
    expect(last().text).toBe('Button.')
    finishPiece()
    expect(last().text).toBe('Auto.')
  })

  it('stays out of a pause: the paused message stays where it was', () => {
    speakReply('auto', reply, 'queue')
    const first = last().text
    spokenOffset.mockReturnValue(16)
    pauseReading('test')
    spokenOffset.mockReturnValue(0)
    speakReply('button', 'Button.', 'interrupt')
    finishPiece()
    expect(last().text).toBe('Button.')
    expect(lastState()).toBe('paused')
    playReading('test')
    expect(last().text).toBe(first.slice(16))
  })

  it('stays out of a Stop: the queue stays stopped afterwards', () => {
    speakReply('auto', 'Auto.', 'queue')
    speakReply('waiting', 'Waiting.', 'queue')
    stopReading('test')
    speakReply('button', 'Button.', 'interrupt')
    finishPiece()
    expect(last().text).toBe('Button.')
    expect(lastState()).toBe('stopped')
  })

  it('stops alone: silence, with the queue paused at its word for Play', () => {
    speakReply('auto', reply, 'queue')
    const first = last().text
    spokenOffset.mockReturnValue(16)
    speakReply('button', 'Button.', 'interrupt')
    spokenOffset.mockReturnValue(0)
    stopReading('test')
    expect(last().text).toBe('Button.')
    expect(lastState()).toBe('paused')
    playReading('test')
    expect(last().text).toBe(first.slice(16))
  })

  it('goes idle when stopped with nothing behind it', () => {
    speakReply('button', 'Button.', 'interrupt')
    stopReading('test')
    expect(lastState()).toBe('idle')
  })

  it('replaces its own message, and the queue still goes on after the second', () => {
    speakReply('auto', 'Auto.', 'queue')
    speakReply('one', 'One.', 'interrupt')
    speakReply('two', 'Two.', 'interrupt')
    finishPiece()
    expect(spoken.map(({ text }) => text)).toEqual(['Auto.', 'One.', 'Two.', 'Auto.'])
  })

  it('reads a waiting message once when the Read button gets to it first', () => {
    speakReply('pane#1', 'Auto.', 'queue')
    speakReply('pane#2', 'Waiting.', 'queue', { chime: true, name: 'Mobile App' })
    speakReply('2', 'Waiting.', 'interrupt')
    expect(last().text).toBe('Waiting.')
    finishPiece()
    expect(last().text).toBe('Auto.')
    finishPiece()
    expect(lastState()).toBe('idle')
    expect(spoken.map(({ text }) => text)).toEqual(['Auto.', 'Waiting.', 'Auto.'])
  })

  it('reads the message being read once when the Read button asks for it', () => {
    speakReply('pane#1', 'Auto.', 'queue')
    speakReply('1', 'Auto.', 'interrupt')
    finishPiece()
    expect(lastState()).toBe('idle')
    expect(spoken.map(({ text }) => text)).toEqual(['Auto.', 'Auto.'])
  })

  it('goes on while auto-read is paused, and its queue message then waits paused', () => {
    speakReply('auto', reply, 'queue')
    speakReply('button', 'Button.', 'interrupt')
    setAutoPlay(false)
    expect(lastState()).toBe('reading')
    finishPiece()
    expect(lastState()).toBe('paused')
    setAutoPlay(true)
    expect(lastState()).toBe('reading')
  })

  it('brings back a paused queue message when auto-read resumes during it', () => {
    speakReply('auto', reply, 'queue')
    const first = last().text
    setAutoPlay(false)
    speakReply('button', 'Button.', 'interrupt')
    setAutoPlay(true)
    expect(last().text).toBe('Button.')
    finishPiece()
    expect(last().text).toBe(first)
  })
})

describe('settings samples', () => {
  it('pauses the reading for a sample and leaves it paused where it was, queue and all', () => {
    speakReply('long', reply, 'queue')
    speakReply('waiting', 'Waiting.', 'queue')
    finishPiece()
    const second = last().text
    spokenOffset.mockReturnValue(16)
    speakSample('Sample.')
    spokenOffset.mockReturnValue(0)
    expect(last().text).toBe('Sample.')
    const before = spoken.length
    finishPiece()
    expect(spoken).toHaveLength(before)
    expect(lastStatus()).toBe('Paused · 1 more waiting')
    playReading('test')
    expect(last().text).toBe(second.slice(16))
  })

  it('ignores a sample once the reader plays again', () => {
    playChimeSample()
    const sample = last().handlers
    speakReply('auto', 'Auto.', 'queue')
    sample.onError?.({ message: 'the chime could not play' })
    expect(spoken.map(({ text }) => text)).toEqual(['(chime)', 'Auto.'])
  })
})

describe('auto-read paused', () => {
  it('pauses the message being read and keeps new ones waiting', () => {
    speakReply('first', 'First.', 'queue')
    setAutoPlay(false)
    expect(lastState()).toBe('paused')
    speakReply('second', 'Second.', 'queue')
    speakReply('third', 'Third.', 'queue')
    expect(spoken.map(({ text }) => text)).toEqual(['First.'])
    expect(lastStatus()).toBe('Paused · 2 more waiting')
  })

  it('reads one message for each Play, and goes through the rest when resumed', () => {
    speakReply('first', 'First.', 'queue')
    setAutoPlay(false)
    speakReply('second', 'Second.', 'queue')
    speakReply('third', 'Third.', 'queue')
    playReading('test')
    expect(last().text).toBe('First.')
    finishPiece()
    expect(lastState()).toBe('stopped')
    expect(lastStatus()).toBe('2 waiting')
    playReading('test')
    expect(last().text).toBe('Second.')
    setAutoPlay(true)
    finishPiece()
    expect(last().text).toBe('Third.')
  })

  it('starts what waited when resumed with nothing being read', () => {
    setAutoPlay(false)
    speakReply('later', 'Later.', 'queue')
    expect(spoken).toEqual([])
    setAutoPlay(true)
    expect(last().text).toBe('Later.')
  })

  it('lets Previous read the last message again while messages wait, not once idle', () => {
    speakReply('read', 'First.', 'queue')
    finishPiece()
    setAutoPlay(false)
    speakReply('unread', 'Second.', 'queue')
    expect(native.setReaderState.mock.calls.at(-1)?.[4]).toBe(true)
    previousMessage('test')
    expect(last().text).toBe('First.')
    resetReader()
    expect(native.setReaderState.mock.calls.at(-1)?.[4]).toBe(false)
  })

  it('plays a waiting message through the speaker when asked, with headphones only on', () => {
    setAutoReadNeedsHeadphones(true)
    native.isPrivateOutput.mockReturnValue(false)
    setAutoPlay(false)
    speakReply('waiting', 'Waiting.', 'queue')
    nextMessage('test')
    expect(last().text).toBe('Waiting.')
  })
})

describe('previous and auto-read stops', () => {
  it('does not read a message twice when Previous picks one that also waits', () => {
    speakReply('a', 'First.', 'queue')
    finishPiece()
    speakReply('b', 'Second.', 'queue')
    previousMessage('test')
    expect(last().text).toBe('First.')
    setAutoPlay(false)
    playReading('test')
    finishPiece()
    previousMessage('test')
    expect(last().text).toBe('Second.')
    finishPiece()
    setAutoPlay(true)
    expect(lastState()).toBe('idle')
  })

  it('stops what auto-read started and leaves the Read button alone', () => {
    speakReply('auto', 'Auto.', 'queue')
    speakReply('waiting', 'Waiting.', 'queue')
    stopAutoReading('test')
    expect(lastState()).toBe('idle')
    speakReply('manual', 'Manual.', 'interrupt')
    speakReply('queued', 'Queued.', 'queue')
    stopAutoReading('test')
    expect(lastState()).toBe('reading')
    finishPiece()
    expect(last().text).toBe('Manual.')
    expect(lastState()).toBe('idle')
  })
})

describe('interruptions', () => {
  it('holds the reading for a call and goes on when it ends', () => {
    speakReply('call', reply, 'queue')
    finishPiece()
    const second = last().text
    audio.current('held', null)
    expect(lastState()).toBe('paused')
    // The focus request stays, so the call's end is reported.
    expect(stopUtterances).not.toHaveBeenCalled()
    audio.current('regained', null)
    expect(last().text).toBe(second)
    expect(lastState()).toBe('reading')
  })

  it('ends the reading after a call too long to go on from', () => {
    speakReply('long-call', reply, 'queue')
    audio.current('held', null)
    vi.setSystemTime(Date.now() + RESUME_WITHIN_MS + 1)
    const before = spoken.length
    audio.current('regained', null)
    expect(spoken).toHaveLength(before)
    expect(lastState()).toBe('idle')
  })

  it('stays paused after a call when auto-read was paused during it', () => {
    speakReply('call', reply, 'queue')
    finishPiece()
    const second = last().text
    audio.current('held', null)
    setAutoPlay(false)
    const before = spoken.length
    audio.current('regained', null)
    expect(spoken).toHaveLength(before)
    expect(lastState()).toBe('paused')
    setAutoPlay(true)
    expect(last().text).toBe(second)
  })

  it('lets the audio go when a call starts with nothing to read', () => {
    audio.current('held', null)
    expect(stopUtterances).toHaveBeenCalled()
  })

  it('does not hold the reading forever when a call never gives the audio back', () => {
    speakReply('lost', reply, 'queue')
    speakReply('waiting', 'Waiting.', 'queue')
    audio.current('held', null)
    expireHolds(Date.now() + RESUME_WITHIN_MS + 1)
    expect(lastState()).toBe('stopped')
    expect(lastStatus()).toBe('1 waiting')
  })
})

describe('headphones only', () => {
  it('skips auto-read through the phone speaker, but not the Read button', () => {
    setAutoReadNeedsHeadphones(true)
    native.isPrivateOutput.mockReturnValue(false)
    speakReply('auto', 'Auto.', 'queue')
    expect(spoken).toEqual([])
    speakReply('button', 'Button.', 'interrupt')
    expect(last().text).toBe('Button.')
  })

  it('pauses when the headphones go and goes on when they are back', () => {
    setAutoReadNeedsHeadphones(true)
    speakReply('ears', reply, 'queue')
    const first = last().text
    audio.current('noisy', null)
    expect(lastState()).toBe('paused')
    audio.current('private-output', null)
    expect(last().text).toBe(first)
  })

  it('ignores unplugging when the option is off', () => {
    speakReply('speaker', reply, 'queue')
    audio.current('noisy', null)
    expect(lastState()).toBe('reading')
  })
})
