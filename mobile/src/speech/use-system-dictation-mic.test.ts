import { describe, expect, it } from 'vitest'
import { appendDictatedText } from './use-system-dictation-mic'

describe('appendDictatedText', () => {
  it('adds what was heard after the draft with one space', () => {
    expect(appendDictatedText('', ' Hello there ')).toBe('Hello there')
    expect(appendDictatedText('Fix the bug', 'in the reader')).toBe('Fix the bug in the reader')
    expect(appendDictatedText('Fix the bug\n', 'next line')).toBe('Fix the bug\nnext line')
    expect(appendDictatedText('Draft', '   ')).toBe('Draft')
  })
})
