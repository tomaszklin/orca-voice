import {
  DEFAULT_PROJECT_NAME_MODE,
  PROJECT_NAME_MODE_KEY,
  type ProjectNameMode
} from '../storage/speech-preferences'
import { createStoredChoice } from './stored-choice'

/**
 * Orca Voice fork: auto-read names the project before a message (owner's request, 2026-10-25), so
 * a voice from one of several agents can be placed without looking at the phone.
 */
export const useProjectNameMode = createStoredChoice<ProjectNameMode>(
  PROJECT_NAME_MODE_KEY,
  ['on-change', 'every', 'off'],
  DEFAULT_PROJECT_NAME_MODE
)

/** After this long without a message, `on-change` names the project again even if it is the same. */
export const PROJECT_NAME_REPEAT_AFTER_MS = 2 * 60_000

/** "OrcaVoice" → "Orca Voice", "on-the_road" → "on the road": TTS reads a joined name as one word. */
export function spokenProjectName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type LastReadMessage = { readonly project: string | null; readonly at: number }

/** What to say before a message from `project`, or null to say nothing. */
export function projectNameIntro(
  mode: ProjectNameMode,
  project: string | null,
  last: LastReadMessage | null,
  now: number
): string | null {
  if (mode === 'off' || !project) {
    return null
  }
  const sameAsLast =
    last !== null && last.project === project && now - last.at < PROJECT_NAME_REPEAT_AFTER_MS
  return mode === 'on-change' && sameAsLast ? null : spokenProjectName(project)
}
