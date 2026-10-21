import { describe, expect, it } from 'vitest'
import { splitForSpeech, toSpeechText } from './speech-text'

const placeholders = { code: 'Code skipped.', table: 'Table skipped.', link: 'link' }

describe('toSpeechText', () => {
  it('replaces code blocks and tables with short cues', () => {
    const markdown = [
      'Before.',
      '',
      '| Day | Run |',
      '|---|---|',
      '| Tue | Intervals |',
      '',
      '```ts',
      'const x = 1',
      '```',
      'After.'
    ].join('\n')
    expect(toSpeechText(markdown, placeholders)).toBe('Before. Table skipped. Code skipped. After.')
  })

  it('strips formatting, links and paths but keeps the words', () => {
    const markdown = [
      '## Summary ✅',
      '- Changed **plan** in `trening/plan-aktualny.md:42`',
      '- Tuesday → intervals',
      'See [zones](trening/strefy.md) or https://example.com/x'
    ].join('\n')
    expect(toSpeechText(markdown, placeholders)).toBe(
      'Summary. Changed plan in plan aktualny. Tuesday, intervals. See zones or link.'
    )
  })

  it('reads source links by their label and bare addresses as a cue', () => {
    const markdown = [
      'Sources:',
      '- [WHO report 2025](https://www.who.int/publications/i/item/9789240000000)',
      '- <https://example.com/study.pdf>'
    ].join('\n')
    expect(toSpeechText(markdown, placeholders)).toBe('Sources: WHO report 2025. link.')
  })

  it('keeps inline code that is not a path', () => {
    expect(toSpeechText('Run `pnpm test` now', placeholders)).toBe('Run pnpm test now.')
  })
})

describe('splitForSpeech', () => {
  it('keeps short text whole', () => {
    expect(splitForSpeech('One. Two.', 100)).toEqual(['One. Two.'])
  })

  it('cuts long text at sentence ends within the limit', () => {
    const chunks = splitForSpeech('First sentence here. Second sentence here. Third one.', 30)
    expect(chunks).toEqual(['First sentence here.', 'Second sentence here.', 'Third one.'])
    expect(chunks.every((chunk) => chunk.length <= 30)).toBe(true)
  })
})
