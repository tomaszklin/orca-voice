import {
  CHIME_MODE_KEY,
  DEFAULT_CHIME_MODE,
  DEFAULT_PROJECT_NAME_MODE,
  PROJECT_NAME_MODE_KEY,
  type ChimeMode,
  type ProjectNameMode
} from '../storage/speech-preferences'
import { createStoredChoice } from './stored-choice'

/**
 * Orca Voice fork: what auto-read says before a message. The project name (owner's request,
 * 2026-10-25) places a voice from one of several agents without looking at the phone; the chime
 * (2026-10-28) says Orca is about to talk, with or instead of the name.
 */
export const useProjectNameMode = createStoredChoice<ProjectNameMode>(
  PROJECT_NAME_MODE_KEY,
  ['on-change', 'every', 'off'],
  DEFAULT_PROJECT_NAME_MODE
)

export const useChimeMode = createStoredChoice<ChimeMode>(
  CHIME_MODE_KEY,
  ['on-change', 'every', 'off'],
  DEFAULT_CHIME_MODE
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

/** `on-change` skips the intro right after a message from the same project. */
function introDue(
  mode: ProjectNameMode,
  project: string | null,
  last: LastReadMessage | null,
  now: number
): boolean {
  if (mode !== 'on-change') {
    return mode === 'every'
  }
  return !(
    last !== null &&
    last.project === project &&
    now - last.at < PROJECT_NAME_REPEAT_AFTER_MS
  )
}

/** What to say before a message from `project`, or null to say nothing. */
export function projectNameIntro(
  mode: ProjectNameMode,
  project: string | null,
  last: LastReadMessage | null,
  now: number
): string | null {
  return project && introDue(mode, project, last, now) ? spokenProjectName(project) : null
}

/** Whether the chime goes before a message from `project`. */
export function chimeBeforeMessage(
  mode: ChimeMode,
  project: string | null,
  last: LastReadMessage | null,
  now: number
): boolean {
  return introDue(mode, project, last, now)
}
