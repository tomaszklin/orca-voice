/**
 * Orca Voice fork: the text a phone file leaves in the chat draft (owner's request, 2026-10-25).
 *
 * Official Orca attaches files only to structured chats, so a terminal-backed chat gets the upload's
 * path as text. A desktop from v1.4.243 keeps the file's own name; an older one saves any bytes as
 * `orca-paste-<time>-<uuid>.png`, so the draft then names the real type and asks the agent to copy
 * it first: reading a PDF as a .png sends it to the model as a broken image.
 */

type KnownFileType = { readonly label: string; readonly extension: string }

const KNOWN_FILE_TYPES: Readonly<Record<string, KnownFileType>> = {
  'application/pdf': { label: 'PDF', extension: 'pdf' },
  'text/plain': { label: 'text file', extension: 'txt' },
  'text/markdown': { label: 'Markdown file', extension: 'md' },
  'text/csv': { label: 'CSV file', extension: 'csv' },
  'text/html': { label: 'HTML file', extension: 'html' },
  'application/json': { label: 'JSON file', extension: 'json' },
  'application/zip': { label: 'ZIP archive', extension: 'zip' },
  'application/msword': { label: 'Word document', extension: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    label: 'Word document',
    extension: 'docx'
  },
  'application/vnd.ms-excel': { label: 'Excel spreadsheet', extension: 'xls' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    label: 'Excel spreadsheet',
    extension: 'xlsx'
  },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    label: 'PowerPoint presentation',
    extension: 'pptx'
  },
  'audio/mpeg': { label: 'MP3 audio', extension: 'mp3' },
  'audio/mp4': { label: 'M4A audio', extension: 'm4a' },
  'video/mp4': { label: 'MP4 video', extension: 'mp4' }
}

const EXTENSION_RE = /\.([a-z0-9]{1,8})$/i
// What a desktop older than v1.4.243 names every phone upload, whatever its name.
const UNNAMED_UPLOAD_RE = /^orca-paste-\d+-[^\\/]+\.png$/i

export type ChatFileReferenceInput = {
  /** Where the host saved the upload. */
  readonly path: string
  readonly mime: string
  /** The file's own name, as the picker reports it. */
  readonly name: string
}

export function hostKeptFileName(path: string): boolean {
  return !UNNAMED_UPLOAD_RE.test(path.split(/[\\/]/).pop() ?? '')
}

function fileExtension(input: ChatFileReferenceInput): string | null {
  const fromName = EXTENSION_RE.exec(input.name)?.[1]
  if (fromName) {
    return fromName.toLowerCase()
  }
  return KNOWN_FILE_TYPES[input.mime.toLowerCase()]?.extension ?? null
}

function fileLabel(mime: string): string {
  return KNOWN_FILE_TYPES[mime.toLowerCase()]?.label ?? `file of type ${mime}`
}

export function buildChatFileReference(input: ChatFileReferenceInput): string {
  // Backticks keep the agent TUI from taking a bare `.png` path in the message as an image paste.
  const saved = `\`${input.path}\``
  const named = ` "${input.name}"`
  if (hostKeptFileName(input.path)) {
    return `[File from my phone${named}, saved on this computer as ${saved}]`
  }
  if (input.mime.toLowerCase().startsWith('image/')) {
    return `[Image from my phone${named}, saved on this computer as ${saved}]`
  }
  const extension = fileExtension(input)
  const copy = extension
    ? `copy it to a .${extension} file before opening it`
    : 'check what it is and copy it to a file with the right extension before opening it'
  return (
    `[File from my phone${named} (${fileLabel(input.mime)}), saved on this computer as ${saved}. ` +
    `It is not an image despite the .png name: ${copy}.]`
  )
}

/** Appends to the draft with a trailing space, so the next typed word does not glue onto it. */
export function appendChatFileReference(draft: string, reference: string): string {
  if (draft.length === 0) {
    return `${reference} `
  }
  const separator = /\s$/.test(draft) ? '' : ' '
  return `${draft}${separator}${reference} `
}
