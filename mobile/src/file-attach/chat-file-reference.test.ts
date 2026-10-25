import { describe, expect, it } from 'vitest'
import { appendChatFileReference, buildChatFileReference } from './chat-file-reference'

const PATH = 'C:\\Temp\\orca-paste-1-abc.png'

describe('buildChatFileReference', () => {
  it('names a PDF and asks for a .pdf copy, with the path in backticks', () => {
    expect(buildChatFileReference({ path: PATH, mime: 'application/pdf' })).toBe(
      '[File from my phone (PDF), saved on this computer as `C:\\Temp\\orca-paste-1-abc.png`. ' +
        'It is not an image despite the .png name: copy it to a .pdf file before opening it.]'
    )
  })

  it('prefers the extension of the file name over the type', () => {
    expect(
      buildChatFileReference({ path: PATH, mime: 'application/octet-stream', name: 'notes.TXT' })
    ).toContain('"notes.TXT" (file of type application/octet-stream)')
    expect(
      buildChatFileReference({ path: PATH, mime: 'application/octet-stream', name: 'notes.TXT' })
    ).toContain('copy it to a .txt file')
  })

  it('asks the agent to work out an unknown type', () => {
    expect(buildChatFileReference({ path: PATH, mime: 'application/octet-stream' })).toContain(
      'check what it is and copy it to a file with the right extension'
    )
  })

  it('leaves images as images', () => {
    expect(buildChatFileReference({ path: PATH, mime: 'image/jpeg' })).toBe(
      '[Image from my phone, saved on this computer as `C:\\Temp\\orca-paste-1-abc.png`]'
    )
  })

  it('never ends on the bare .png path', () => {
    for (const mime of ['application/pdf', 'image/png', 'application/x-unknown']) {
      expect(buildChatFileReference({ path: PATH, mime })).not.toMatch(/\.png\s*$/)
    }
  })
})

describe('appendChatFileReference', () => {
  it('starts an empty draft and leaves a space for the next word', () => {
    expect(appendChatFileReference('', '[F]')).toBe('[F] ')
  })

  it('separates from typed text only when needed', () => {
    expect(appendChatFileReference('read this', '[F]')).toBe('read this [F] ')
    expect(appendChatFileReference('read this ', '[F]')).toBe('read this [F] ')
    expect(appendChatFileReference('line\n', '[F]')).toBe('line\n[F] ')
  })
})
