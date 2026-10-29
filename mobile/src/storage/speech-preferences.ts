import AsyncStorage from '@react-native-async-storage/async-storage'

export const AUTO_READ_REPLIES_KEY = 'orca:autoReadReplies'
export const BACKGROUND_READING_KEY = 'orca:voiceBackgroundReading'
const BUILT_IN_PAGE_KEY = 'orca:voiceBuiltInPage'

/** An on/off setting, stored as text. */
export type StoredFlag = 'true' | 'false'

// Why: off by default, so replies are only spoken when the user asked for it.
export const DEFAULT_AUTO_READ_REPLIES: StoredFlag = 'false'
// Why: on by default — it only runs while auto-read is on, and reading with the phone in a pocket
// is what auto-read is for.
export const DEFAULT_BACKGROUND_READING: StoredFlag = 'true'
// Why: on by default — the built-in page is what carries the chat's Read button.
export const DEFAULT_BUILT_IN_PAGE = true

// Orca Voice fork: the built-in page choice is also read outside React (the shell session's
// effects), so it keeps a plain load/save pair instead of a stored choice.
export async function loadBuiltInPage(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(BUILT_IN_PAGE_KEY)
    return raw === null ? DEFAULT_BUILT_IN_PAGE : raw === 'true'
  } catch {
    return DEFAULT_BUILT_IN_PAGE
  }
}

export function saveBuiltInPage(enabled: boolean): Promise<void> {
  return AsyncStorage.setItem(BUILT_IN_PAGE_KEY, enabled ? 'true' : 'false')
}

export const READ_SCOPE_KEY = 'orca:voiceReadScope'

/**
 * `all`: every message, including what the agent writes while working. `replies`: only the answer
 * that ends a turn. `all-on-screen`: `all` while Orca is on screen, `replies` while it is not.
 */
export type ReadScope = 'all' | 'all-on-screen' | 'replies'

// Why: `all` by default — the owner found only turn-ending replies were read (2026-10-21).
export const DEFAULT_READ_SCOPE: ReadScope = 'all'

export const PROJECT_NAME_MODE_KEY = 'orca:voiceProjectName'

/** Whether auto-read names a message's project first: `on-change` only when it differs from the last. */
export type ProjectNameMode = 'on-change' | 'every' | 'off'

// Why: on — the owner asked for it (2026-10-25); `on-change` so one agent's run is not named each time.
export const DEFAULT_PROJECT_NAME_MODE: ProjectNameMode = 'on-change'

export const CHIME_MODE_KEY = 'orca:voiceChime'

/** Whether auto-read plays a short chime before a message, by the same rule as the project name. */
export type ChimeMode = ProjectNameMode

// Why: every message — the owner asked for it (2026-10-28), and it marks where one message ends
// and the next begins when several are read back to back.
export const DEFAULT_CHIME_MODE: ChimeMode = 'every'

export const ANNOUNCE_WAITS_KEY = 'orca:voiceAnnounceWaits'

/** Whether auto-read says when an agent stops to wait for the user (a question, a permission). */
export type AnnounceWaits = 'on' | 'off'

export const DEFAULT_ANNOUNCE_WAITS: AnnounceWaits = 'on'

export const LINK_READING_KEY = 'orca:voiceLinks'

/**
 * How a link is read: `word-and-text` "link WHO report", `text` "WHO report", `word-text-site`
 * "link WHO report, who.int", `off` not at all. A bare address has no text, so it is "link".
 */
export type LinkReading = 'word-and-text' | 'text' | 'word-text-site' | 'off'

// Why: the owner asked for "link" before every link (2026-10-28); until then only the text was read.
export const DEFAULT_LINK_READING: LinkReading = 'word-and-text'

export const HEADPHONES_ONLY_KEY = 'orca:voiceHeadphonesOnly'

/** Whether auto-read stays quiet unless sound goes to headphones, a car or the like. */
export type HeadphonesOnly = 'on' | 'off'

export const DEFAULT_HEADPHONES_ONLY: HeadphonesOnly = 'off'

export const LANGUAGE_VOICES_KEY = 'orca:voiceLanguageVoices'

/** Whether a sentence in another language is read with a voice for that language. */
export type LanguageVoices = 'on' | 'off'

export const DEFAULT_LANGUAGE_VOICES: LanguageVoices = 'on'
