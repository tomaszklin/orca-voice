import AsyncStorage from '@react-native-async-storage/async-storage'

const AUTO_READ_REPLIES_KEY = 'orca:autoReadReplies'
const BUILT_IN_PAGE_KEY = 'orca:voiceBuiltInPage'
const BACKGROUND_READING_KEY = 'orca:voiceBackgroundReading'

// Why: off by default, so replies are only spoken when the user asked for it.
export const DEFAULT_AUTO_READ_REPLIES = false
// Why: on by default — the built-in page is what carries the chat's Read button.
export const DEFAULT_BUILT_IN_PAGE = true
// Why: on by default — it only runs while auto-read is on, and reading with the phone in a pocket
// is what auto-read is for.
export const DEFAULT_BACKGROUND_READING = true

async function loadFlag(key: string, fallback: boolean): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw === null ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

function saveFlag(key: string, value: boolean): Promise<void> {
  return AsyncStorage.setItem(key, value ? 'true' : 'false')
}

export function loadAutoReadReplies(): Promise<boolean> {
  return loadFlag(AUTO_READ_REPLIES_KEY, DEFAULT_AUTO_READ_REPLIES)
}

export function saveAutoReadReplies(enabled: boolean): Promise<void> {
  return saveFlag(AUTO_READ_REPLIES_KEY, enabled)
}

export function loadBuiltInPage(): Promise<boolean> {
  return loadFlag(BUILT_IN_PAGE_KEY, DEFAULT_BUILT_IN_PAGE)
}

export function saveBuiltInPage(enabled: boolean): Promise<void> {
  return saveFlag(BUILT_IN_PAGE_KEY, enabled)
}

export function loadBackgroundReading(): Promise<boolean> {
  return loadFlag(BACKGROUND_READING_KEY, DEFAULT_BACKGROUND_READING)
}

export function saveBackgroundReading(enabled: boolean): Promise<void> {
  return saveFlag(BACKGROUND_READING_KEY, enabled)
}

const READ_SCOPE_KEY = 'orca:voiceReadScope'

/**
 * `all`: every message, including what the agent writes while working. `replies`: only the answer
 * that ends a turn. `all-on-screen`: `all` while Orca is on screen, `replies` while it is not.
 */
export type ReadScope = 'all' | 'all-on-screen' | 'replies'

// Why: `all` by default — the owner found only turn-ending replies were read (2026-10-21).
export const DEFAULT_READ_SCOPE: ReadScope = 'all'

export async function loadReadScope(): Promise<ReadScope> {
  try {
    const raw = await AsyncStorage.getItem(READ_SCOPE_KEY)
    return raw === 'all' || raw === 'all-on-screen' || raw === 'replies' ? raw : DEFAULT_READ_SCOPE
  } catch {
    return DEFAULT_READ_SCOPE
  }
}

export function saveReadScope(scope: ReadScope): Promise<void> {
  return AsyncStorage.setItem(READ_SCOPE_KEY, scope)
}
