import { describe, expect, it } from 'vitest'
import {
  appendChatFileReference,
  buildChatFileReference,
  hostKeptFileName
} from './chat-file-reference'

const UNNAMED = 'C:\\Temp\\orca-paste-1761640000000-0b9c2f6e-1d2a-4f3e-9a8b-7c6d5e4f3a2b.png'
const NAMED = 'C:\\Temp\\orca-paste-0b9c2f6e-1d2a-4f3e-9a8b-7c6d5e4f3a2b\\report.pdf'

describe('hostKeptFileName', () => {
  it('tells an older desktop’s .png name from a kept one', () => {
    expect(hostKeptFileName(UNNAMED)).toBe(false)
    expect(hostKeptFileName('/tmp/orca-paste-1-abc.png')).toBe(false)
    expect(hostKeptFileName(NAMED)).toBe(true)
    expect(hostKeptFileName('/tmp/orca-paste-abc/photo.png')).toBe(true)
  })
})

describe('buildChatFileReference', () => {
  it('gives the kept path as it is', () => {
    expect(
      buildChatFileReference({ path: NAMED, mime: 'application/pdf', name: 'report.pdf' })
    ).toBe(`[File from my phone "report.pdf", saved on this computer as \`${NAMED}\`]`)
  })

  it('names a PDF on an older desktop and asks for a .pdf copy', () => {
    expect(
      buildChatFileReference({ path: UNNAMED, mime: 'application/pdf', name: 'report.pdf' })
    ).toBe(
      `[File from my phone "report.pdf" (PDF), saved on this computer as \`${UNNAMED}\`. ` +
        'It is not an image despite the .png name: copy it to a .pdf file before opening it.]'
    )
  })

  it('prefers the extension of the file name over the type', () => {
    const reference = buildChatFileReference({
      path: UNNAMED,
      mime: 'application/octet-stream',
      name: 'notes.TXT'
    })
    expect(reference).toContain('"notes.TXT" (file of type application/octet-stream)')
    expect(reference).toContain('copy it to a .txt file')
  })

  it('asks the agent to work out an unknown type', () => {
    expect(
      buildChatFileReference({ path: UNNAMED, mime: 'application/octet-stream', name: 'blob' })
    ).toContain('check what it is and copy it to a file with the right extension')
  })

  it('leaves images on an older desktop as images', () => {
    expect(buildChatFileReference({ path: UNNAMED, mime: 'image/jpeg', name: 'a.jpg' })).toBe(
      `[Image from my phone "a.jpg", saved on this computer as \`${UNNAMED}\`]`
    )
  })

  it('never ends on a bare path', () => {
    for (const path of [UNNAMED, NAMED]) {
      for (const mime of ['application/pdf', 'image/png', 'application/x-unknown']) {
        expect(buildChatFileReference({ path, mime, name: 'x' })).toMatch(/[\]]$/)
      }
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
