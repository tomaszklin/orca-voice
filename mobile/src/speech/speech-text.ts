// Android's TextToSpeech rejects longer inputs (TextToSpeech.getMaxSpeechInputLength() is 4000).
export const MAX_SPEECH_CHUNK_LENGTH = 3900

type Placeholders = { code: string; table: string; link: string }

const PLACEHOLDERS: Record<'pl' | 'en', Placeholders> = {
  pl: { code: 'Pomijam fragment kodu.', table: 'Pomijam tabelę.', link: 'link' },
  en: { code: 'Code block skipped.', table: 'Table skipped.', link: 'link' }
}

function devicePlaceholders(): Placeholders {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    return locale.toLowerCase().startsWith('pl') ? PLACEHOLDERS.pl : PLACEHOLDERS.en
  } catch {
    return PLACEHOLDERS.en
  }
}

/** `src/foo/plan-aktualny.md:12` → "plan aktualny": paths read aloud are noise, the name is not. */
function speakableInlineCode(code: string): string {
  if (!/[\\/]/.test(code)) {
    return code
  }
  const last = code.split(/[\\/]/).pop() ?? code
  return last
    .replace(/:\d+$/, '')
    .replace(/\.\w{1,5}$/, '')
    .replace(/[-_]/g, ' ')
}

/**
 * Turns an agent's markdown reply into text worth hearing: code blocks and tables become a short
 * cue, links and formatting are stripped, and every line ends as a sentence so list items get a
 * pause instead of running together.
 */
export function toSpeechText(markdown: string, placeholders = devicePlaceholders()): string {
  let text = markdown.replace(/\r/g, '')
  text = text.replace(/^[ \t]*```[\s\S]*?^[ \t]*```[^\n]*$/gm, `\n${placeholders.code}\n`)
  text = text.replace(/(^[ \t]*\|.*\|[ \t]*(\n|$))+/gm, `${placeholders.table}\n`)
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  text = text.replace(/<?https?:\/\/[^\s>]+>?/g, placeholders.link)
  text = text.replace(/`([^`\n]+)`/g, (_, code: string) => speakableInlineCode(code))
  text = text.replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
  text = text.replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, '')
  text = text.replace(/^[ \t]*>[ \t]?/gm, '')
  text = text.replace(/\*\*|__|~~/g, '')
  text = text.replace(/(?<![\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1')
  text = text.replace(/\s*[→⇒➜]\s*/g, ', ')
  text = text.replace(/\p{Extended_Pictographic}|️|‍/gu, '')

  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .map((line) => (/[.!?:;,…]$/.test(line) ? line : `${line}.`))
    .join(' ')
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
