import type { FileReading, LinkReading, TableReading } from '../storage/speech-preferences'
import { readerWords, type ReaderWords } from './reader-words'
import { fileLinkText, speakableFiles } from './speech-files'
import { speakableTables } from './speech-tables'

// Android's TextToSpeech rejects longer inputs (TextToSpeech.getMaxSpeechInputLength() is 4000).
export const MAX_SPEECH_CHUNK_LENGTH = 3900

type Placeholders = Pick<ReaderWords, 'code' | 'table' | 'link' | 'at' | 'dot'>

let fileReading: FileReading = 'name'

/** From the Read aloud settings; every reading after it uses it. */
export function setFileReading(mode: FileReading): void {
  fileReading = mode
}

let linkReading: LinkReading = 'word-and-text'

/** From the Read aloud settings; every reading after it uses it. */
export function setLinkReading(mode: LinkReading): void {
  linkReading = mode
}

let tableReading: TableReading = 'with-headers'

/** From the Read aloud settings; every reading after it uses it. */
export function setTableReading(mode: TableReading): void {
  tableReading = mode
}

const ADDRESS = /^<?https?:\/\//i
// Any other target is a file, read as its text: `[plan.md](docs/plan.md)` is a path, not a link.
const WEB_TARGET = /^<?(?:https?:|mailto:)/i
// A link's target, which may hold one level of brackets, e.g. `wiki/Foo_(bar)`, and a title.
const TARGET = String.raw`\(((?:[^()\s]|\([^()\s]*\))*)[^)]*\)`
const IMAGE = new RegExp(String.raw`!\[([^\]]*)\]${TARGET}`, 'g')
const LINK = new RegExp(String.raw`\[([^\]]+)\]${TARGET}`, 'g')

// Why: agents spelled addresses out ("shop małpa x kropka hu") so the voice could read them, which
// left them uncopyable on screen; the reader says them instead (owner's report, 2026-11-05).
const EMAIL = /(?:mailto:)?([\w.+-]+)@([\w-]+(?:\.[\w-]+)+)/gi

/** shop@x.hu → "shop at x dot hu", in the reading voice's words. */
function spokenEmail(local: string, domain: string, at: string, dot: string): string {
  const spell = (part: string) => part.split('.').filter(Boolean).join(` ${dot} `)
  return `${spell(local)} ${at} ${spell(domain)}`
}

/** Punctuation after a bare address, and a ")" closing brackets around it, stay in the text. */
function addressEnd(found: string): number {
  let end = found.length
  while (end > 0) {
    const url = found.slice(0, end)
    const unbalanced = url.split(')').length > url.split('(').length
    if (!/[.,;:!?'"]$/.test(url) && !(url.endsWith(')') && unbalanced)) {
      break
    }
    end -= 1
  }
  return end
}

/** "who.int" for `https://www.who.int/…`; null for a link to a file. */
function linkSite(url: string): string | null {
  return /^<?https?:\/\/(?:www\.)?([^/:?#\s>]+)/i.exec(url)?.[1] ?? null
}

/** A link as `mode` reads it; `label` is null for a bare address. */
function spokenLink(label: string | null, url: string, mode: LinkReading, word: string): string {
  switch (mode) {
    case 'off':
      return ''
    case 'text':
      return label ?? word
    case 'word-and-text':
      return label ? `${word} ${label}` : word
    case 'word-text-site': {
      const site = linkSite(url)
      const named = label ? `${word} ${label}` : word
      return site ? `${named}${label ? ',' : ''} ${site}` : named
    }
  }
}

/**
 * Turns an agent's markdown reply into text worth hearing: code blocks become a short cue, links,
 * tables and file paths are read as `links`, `tables` and `files` say, formatting is stripped, and
 * every line ends as a sentence so list items and table rows get a pause instead of running together.
 */
export function toSpeechText(
  markdown: string,
  placeholders: Placeholders = readerWords(),
  links = linkReading,
  tables = tableReading,
  files = fileReading
): string {
  let text = markdown.replace(/\r/g, '')
  text = text.replace(/^[ \t]*```[\s\S]*?^[ \t]*```[^\n]*$/gm, `\n${placeholders.code}\n`)
  text = speakableTables(text, tables, placeholders.table)
  // An image is read as its alt text; one without any is dropped.
  text = text.replace(IMAGE, (_, alt: string) => alt)
  text = text.replace(LINK, (_, label: string, url: string) =>
    WEB_TARGET.test(url)
      ? spokenLink(ADDRESS.test(label) ? null : label, url, links, placeholders.link)
      : fileLinkText(label, files)
  )
  text = text.replace(/<?(https?:\/\/[^\s<>]+)>?/g, (_, found: string) => {
    const end = addressEnd(found)
    return spokenLink(null, found.slice(0, end), links, placeholders.link) + found.slice(end)
  })
  text = text.replace(EMAIL, (_, local: string, domain: string) =>
    spokenEmail(local, domain, placeholders.at, placeholders.dot)
  )
  // Arrows first, so a rename like `plan.py→trip.py` is read as two files.
  text = text.replace(/\s*[→⇒➜]\s*/g, ', ')
  text = speakableFiles(text, files)
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
  text = text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
  text = text.replace(/^[ \t]*>[ \t]?/gm, '')
  text = text.replace(/\*\*|__|~~/g, '')
  text = text.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1')
  text = text.replace(/\p{Extended_Pictographic}|️|‍/gu, '')

  return (
    text
      .split('\n')
      // A skipped link or path leaves the punctuation after it behind a space, and a lone
      // comma or colon before more punctuation: "Plan: ," → "Plan,".
      .map((line) =>
        line
          .replace(/\s+/g, ' ')
          .replace(/\s+([.,;:!?)])/g, '$1')
          .replace(/[,;:](?=[.,;!?])/g, '')
          .trim()
      )
      .filter((line) => line.length > 0)
      .map((line) => (/[.!?:;,…。！？：；，]$/.test(line) ? line : `${line}.`))
      .join(' ')
  )
}

/** Splits at sentence ends so each piece fits the platform TTS input limit. */
export function splitForSpeech(text: string, maxLength = MAX_SPEECH_CHUNK_LENGTH): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > maxLength) {
    const window = rest.slice(0, maxLength)
    const sentenceEnd = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('! '),
      window.lastIndexOf('? ')
    )
    const cut = sentenceEnd > maxLength / 2 ? sentenceEnd + 1 : window.lastIndexOf(' ')
    const at = cut > 0 ? cut : maxLength
    chunks.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) {
    chunks.push(rest)
  }
  return chunks
}
