import type { FileReading } from '../storage/speech-preferences'

/**
 * Orca Voice fork: file paths in a reply, read as the "File paths" setting says (owner's request,
 * 2026-11-26). Only paths in backticks were cut to a name; a path written as plain text ("Plik:
 * E:\Projects\…\notes.md") or as a link's text was read whole, which is noise when heard.
 */

// Extensions left out of a spoken name. In running text only these make a word a file, since a
// slash or a dot there also joins words, numbers and tags (`and/or`, `FV/90/10/2026`, `UI.Font`).
const KNOWN_EXTENSION =
  /\.(?:md|mdx|txt|log|json|jsonl|ya?ml|toml|ini|cfg|conf|xml|csv|tsv|[cm]?[jt]sx?|py|ps1|psm1|bat|cmd|sh|kts?|java|gradle|swift|[ch]|cpp|hpp|cs|go|rb|php|lua|dart|vue|svelte|html?|s?css|sql|ipynb|pdf|docx?|xlsx?|pptx?|odt|png|jpe?g|gif|svg|webp|bmp|ico|mp[34]|wav|ogg|m4a|mov|mkv|zip|7z|rar|tar|gz|apk|aab|exe|msi|dll|lock|kml|gpx|fit|ics|uproject|uplugin|uasset|umap|patch|diff|bak|tmp|db|sqlite|plist|pem)$/i
// Names that end like a file but are libraries.
const LIBRARY =
  /^(?:node|next|nuxt|vue|react|angular|express|three|chart|d3|p5|alpine|solid|moment|day|anime)\.js$/i
// A line, range or column after a path: `a.ts:12`, `a.ts:12-20`, `a.ts:8,12`, `a.ts:3:5`, `a.ts#L12`.
const LINE = /(?::\d+(?:[-–,]\d+)*){1,2}$|#L\d+(?:-L?\d+)?$/
// What only a path starts with: `./x`, `~/x`, `.claude/x`, `C:\x`, `%TEMP%\x`, `$HOME/x`, `file:///x`.
const PATH_START =
  /^(?:\.{1,2}[\\/]|~[\\/]|\.\p{L}[\p{L}\p{N}_-]*[\\/]|[a-z]:[\\/]|%\w+%[\\/]|\$(?:env:)?\w+[\\/]|\$\{\w+\}[\\/]|file:\/\/\/?(?=[^\s/]))/iu
const SCHEME = /^[a-z][\w+.-]*:\/\//i
// A backslash between two names: in a reply that is a Windows path.
const BACKSLASH_PATH = /[\p{L}\p{N}_.-]\\[\p{L}\p{N}_.-]/u
// In backticks any ending of a letter and up to 11 more counts, e.g. `Tools/gym.pending`.
const CODE_ENDING = /\.\p{L}[\p{L}\p{N}_-]{0,11}$/u
const INLINE_CODE = /`([^`\n]+)`/g
// A word with the brackets, quotes and punctuation around it kept apart: `(docs/a.md),`.
const WORD = /^([(["'„«*~]*)(.*?)([)\]"'”»*~.,;:!?]*)$/su

/** `CLAUDE.md`, `package.json:12`: a file named without its folders. */
function isFileName(word: string): boolean {
  const bare = word.replace(LINE, '')
  return (
    KNOWN_EXTENSION.test(bare) &&
    /^[\p{L}\p{N}_+-][\p{L}\p{N}_.+-]*$/u.test(bare) &&
    !LIBRARY.test(bare)
  )
}

/** `.env`, `.mcp.json`, `.claude`, but not an extension alone like `.md`. */
function isDotName(word: string): boolean {
  return /^\.\p{L}[\p{L}\p{N}_.-]*$/u.test(word) && word.search(KNOWN_EXTENSION) !== 0
}

/** `inCode`: written in backticks, where a slash between words is a path more often. */
function isPath(word: string, inCode: boolean): boolean {
  if (!/[\p{L}\p{N}]/u.test(word)) {
    return false
  }
  if (PATH_START.test(word) || BACKSLASH_PATH.test(word)) {
    return true
  }
  if (SCHEME.test(word)) {
    return false
  }
  const parts = word.replace(LINE, '').split(/[\\/]/)
  const last = parts.at(-1) ?? ''
  if (parts.length === 1) {
    return isFileName(word) || (inCode && isDotName(word))
  }
  if (last === '') {
    // A folder: `Tools/`.
    return true
  }
  if (LIBRARY.test(last)) {
    return false
  }
  if (KNOWN_EXTENSION.test(last)) {
    return true
  }
  // `/etc/hosts` and `a/b/c` are paths, but not `dev-5.6/5.7/5.8`, and `/code-review` is a command.
  return inCode && (CODE_ENDING.test(last) || (parts.length > 2 && /\p{L}/u.test(last)))
}

/** `C:\Program Files\x.exe`: a path with spaces, told from a command by its start and last part. */
function isSpacedPath(code: string): boolean {
  const last = code.split(/[\\/]/).at(-1) ?? ''
  return (
    PATH_START.test(code) &&
    !/[*?"<>|]/.test(code) &&
    (!/\s/.test(last) || KNOWN_EXTENSION.test(last.replace(LINE, '')))
  )
}

/** `plan-aktualny.md:12` → "plan aktualny", `ReleaseNotes.md` → "Release Notes". */
function spokenName(part: string): string {
  const name = part
    .replace(LINE, '')
    .replace(/^\.(?=\p{L})/u, '')
    .replace(KNOWN_EXTENSION, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .trim()
  return name || part
}

function spokenPath(path: string, mode: FileReading): string {
  if (mode === 'skip') {
    return ''
  }
  // `AGENTS.md/CLAUDE.md` is a choice of two files, not a folder and a file.
  const files = path.split('/').filter(Boolean)
  if (files.length > 1 && files.every(isFileName)) {
    return files.map(spokenName).join('/')
  }
  return spokenName(path.split(/[\\/]/).findLast((part) => part.length > 0) ?? path)
}

function speakableWords(text: string, mode: FileReading): string {
  return text.replace(/[^\s`]+/g, (word) => {
    const [, before = '', core = '', after = ''] = WORD.exec(word) ?? []
    return core && isPath(core, false) ? before + spokenPath(core, mode) + after : word
  })
}

function speakableCode(code: string, mode: FileReading): string {
  if (/\s/.test(code)) {
    // A command keeps its words; only the paths in it are cut: `Tools\Compile.bat Development`.
    return isSpacedPath(code) ? spokenPath(code, mode) : speakableWords(code, mode)
  }
  return isPath(code, true) ? spokenPath(code, mode) : code
}

/** A file link's text: one word with a slash is a path, e.g. `Content/Maps`; more words are prose. */
export function fileLinkText(label: string, mode: FileReading): string {
  if (mode === 'full' || /[\s`]/.test(label)) {
    return label
  }
  return /[\\/]/.test(label) || isPath(label, true) ? spokenPath(label, mode) : label
}

/** Drops the backticks of inline code and reads every file path in `text` as `mode` says. */
export function speakableFiles(text: string, mode: FileReading): string {
  if (mode === 'full') {
    return text.replace(INLINE_CODE, '$1')
  }
  let spoken = ''
  let from = 0
  for (const match of text.matchAll(INLINE_CODE)) {
    spoken +=
      speakableWords(text.slice(from, match.index), mode) + speakableCode(match[1] ?? '', mode)
    from = match.index + match[0].length
  }
  return spoken + speakableWords(text.slice(from), mode)
}
