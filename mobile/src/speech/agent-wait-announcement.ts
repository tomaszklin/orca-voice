import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { isAskUserQuestionTool } from '../../../src/shared/agent-question-answered-intent'
import {
  ANNOUNCE_WAITS_KEY,
  DEFAULT_ANNOUNCE_WAITS,
  type AnnounceWaits
} from '../storage/speech-preferences'
import { deviceSpeechLanguage } from './speech-text'
import { createStoredChoice } from './stored-choice'

/**
 * Orca Voice fork: auto-read says when an agent stops to wait for the user — a question, a
 * permission prompt (owner's request, 2026-10-28) — so an agent stuck with the screen off is
 * noticed instead of found later.
 */
export const useAnnounceWaits = createStoredChoice<AnnounceWaits>(
  ANNOUNCE_WAITS_KEY,
  ['on', 'off'],
  DEFAULT_ANNOUNCE_WAITS
)

export type WaitKind = 'question' | 'permission' | 'other'

/** Pane → when its current wait began, or null while it is not waiting. */
export type WaitBaseline = ReadonlyMap<string, number | null>

export type NewWait = { paneKey: string; since: number; kind: WaitKind }

// Claude's PermissionRequest, Elicitation and AskUserQuestion all end in `waiting`; `blocked`
// comes from terminal status reports and structured sessions that need attention.
function waitKind(agent: RuntimeWorktreeAgentRow, state: string): WaitKind {
  if (isAskUserQuestionTool(agent.toolName ?? undefined)) {
    return 'question'
  }
  return state === 'waiting' && agent.toolName ? 'permission' : 'other'
}

/**
 * The agents that started waiting since the last poll, each wait once.
 *
 * Like replies, a pane seen for the first time only records its state, so switching auto-read on
 * never announces a wait that was already there. The main agent's own state is used: it also
 * carries a wait a subagent ran into, while the subagent rows themselves are skipped.
 */
export function findNewWaits(
  baseline: WaitBaseline,
  agents: readonly RuntimeWorktreeAgentRow[]
): { baseline: WaitBaseline; newWaits: NewWait[] } {
  const next = new Map(baseline)
  const newWaits: NewWait[] = []
  for (const agent of agents) {
    if (agent.parentPaneKey) {
      continue
    }
    const state = agent.mainAgent?.state ?? agent.state
    const waiting = state === 'waiting' || state === 'blocked'
    const since = waiting ? (agent.mainAgent?.stateStartedAt ?? agent.stateStartedAt) : null
    const seen = next.get(agent.paneKey)
    next.set(agent.paneKey, since)
    if (seen !== undefined && since !== null && since !== seen) {
      newWaits.push({ paneKey: agent.paneKey, since, kind: waitKind(agent, state) })
    }
  }
  return { baseline: next, newWaits }
}

const PHRASES: Record<'pl' | 'en', Record<WaitKind, string>> = {
  pl: {
    question: 'Agent ma pytanie.',
    permission: 'Agent prosi o zgodę.',
    other: 'Agent czeka na ciebie.'
  },
  en: {
    question: 'The agent has a question.',
    permission: 'The agent asks for permission.',
    other: 'The agent is waiting for you.'
  }
}

/** What is said for a wait; the project name and chime go before it like before any message. */
export function waitAnnouncement(kind: WaitKind, language = deviceSpeechLanguage()): string {
  return PHRASES[language][kind]
}
