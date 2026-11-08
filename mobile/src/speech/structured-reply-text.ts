import { isRootAgentJournalItem } from '../../../src/shared/agent-session/journal/agent-session-journal-producer'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session/journal/agent-session-journal-types'
import type { AgentSessionHistoryResult } from '../../../src/shared/agent-session/agent-session-wire'
import { readAgentJournalTurn } from '../../../src/shared/agent-session/lifecycle/agent-session-turn-record'
import {
  AGENT_STATUS_MAX_FIELD_LENGTH,
  normalizeOptionalField
} from '../../../src/shared/agent-status-field-normalization'
import { latestStructuredAgentSessionAssistantMessage } from '../../../src/shared/agent-session/requests/structured-agent-session-latest-request'
import { mainAgentState } from '../../../src/shared/main-agent-status'
import { callAgentSession } from '../session/mobile-structured-agent-session-rpc'
import type { RpcClient } from '../transport/rpc-client'
import type { AutoReadAgentRow } from './auto-read-agent-rows'
import { logSpeechEvent } from './speech-diagnostics'

/**
 * Orca Voice fork: the replies of a structured chat (Orca's own agent chat, not a terminal), read
 * turn by turn from the chat's history rather than from its `worktree.ps` row. The row carries only
 * a 200-character preview of the last reply, so auto-read stopped mid-sentence (owner, 2026-11-03).
 * And the row is `done` only between two turns: a message the owner queued starts the next turn
 * about 2 seconds after one ends, so polls every 3 or 15 seconds missed every reply but the last
 * (owner, 2026-11-08: asked for a heart-rate plan, then a pace plan, and heard only the pace one).
 */

const PANE_PREFIX = 'structured-agent-session-'
// The turns that ended between two polls and the start of the one running now; the host also
// bounds the page by bytes, keeping the newest items.
const TAIL_ITEMS = 60
const READ_TIMEOUT_MS = 10_000

export type TurnReply = { paneKey: string; message: string; endedAt: number }

type EndedTurn = { item: AgentJournalRenderItem; message: string; endedAt: number }

// What the reader knows of each chat: the main agent's state start at the last poll, the end of
// the last turn handled, and the end of a turn held back while its subagents run.
type PaneTurns = { start: number; after: number; held: number | null }

const isRunningSubagent = ({ state }: { state: string }) =>
  state === 'working' || state === 'blocked' || state === 'waiting'

/** The session in a structured chat's pane key, `structured-agent-session-<id>:<leaf>`. */
export function structuredSessionId(rawPaneKey: string): string | null {
  if (!rawPaneKey.startsWith(PANE_PREFIX)) {
    return null
  }
  const end = rawPaneKey.lastIndexOf(':')
  const id = rawPaneKey.slice(PANE_PREFIX.length, end === -1 ? undefined : end)
  return id || null
}

// The host makes the preview the same way; the prefix covers a preview normalized once more.
function standsFor(preview: string, reply: string): boolean {
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim()
  return (
    normalizeOptionalField(reply, AGENT_STATUS_MAX_FIELD_LENGTH) === preview ||
    flat(reply).startsWith(flat(preview))
  )
}

function isReply(item: AgentJournalRenderItem): boolean {
  return (
    item.body.kind === 'message' && item.body.role === 'assistant' && isRootAgentJournalItem(item)
  )
}

/**
 * The last reply of each turn on the page that ended after `after` (host clock), oldest first. A
 * turn whose own row is off the page has ended when a later turn is on it, its end then taken from
 * its reply; the last one has ended at `doneAt`, when the chat's row says its agent is done.
 */
export function endedTurnReplies(
  items: readonly AgentJournalRenderItem[],
  after: number,
  doneAt: number | null = null
): EndedTurn[] {
  // Turn row id → when it ended, null while it runs; in page order.
  const ends = new Map<string, number | null>()
  const order: string[] = []
  const replies = new Map<string, { item: AgentJournalRenderItem; message: string }>()
  const note = (turnItemId: string) => {
    if (!order.includes(turnItemId)) {
      order.push(turnItemId)
    }
  }
  for (const item of items) {
    const turn = readAgentJournalTurn(item.body)
    if (turn) {
      ends.set(item.itemId, turn.state === 'running' ? null : (turn.completedAt ?? null))
      note(item.itemId)
      continue
    }
    if (item.turnScope?.kind !== 'turn' || !isReply(item)) {
      continue
    }
    const message = latestStructuredAgentSessionAssistantMessage([item])
    if (message.trim()) {
      note(item.turnScope.turnItemId)
      replies.set(item.turnScope.turnItemId, { item, message })
    }
  }
  return order.flatMap((turnItemId, index) => {
    const reply = replies.get(turnItemId)
    const laterTurn = index < order.length - 1
    const endedAt = ends.has(turnItemId)
      ? ends.get(turnItemId)
      : laterTurn
        ? reply?.item.observedAt
        : doneAt
    return reply && endedAt != null && endedAt > after ? [{ ...reply, endedAt }] : []
  })
}

/** `turn`'s reply whole, when the page carried a shortened copy. */
async function wholeReply(client: RpcClient, sessionId: string, turn: EndedTurn): Promise<string> {
  if (!turn.item.shortened) {
    return turn.message
  }
  const { item } = await callAgentSession<{ item: AgentJournalRenderItem | null }>(
    client,
    'agentSession.item',
    { sessionId, itemId: turn.item.itemId },
    READ_TIMEOUT_MS
  )
  const message = item ? latestStructuredAgentSessionAssistantMessage([item]) : ''
  return message.trim() ? message : turn.message
}

/** The ended turns' replies, and the chat's newest reply for a row whose turn is not among them. */
async function readTurns(
  client: RpcClient,
  sessionId: string,
  after: number,
  doneAt: number | null
): Promise<{ turns: { message: string; endedAt: number }[]; newest: string }> {
  const result = await callAgentSession<AgentSessionHistoryResult>(
    client,
    'agentSession.history',
    { sessionId, direction: 'tail', limit: TAIL_ITEMS },
    READ_TIMEOUT_MS
  )
  const turns = await Promise.all(
    endedTurnReplies(result.page.items, after, doneAt).map(async (turn) => ({
      message: await wholeReply(client, sessionId, turn),
      endedAt: turn.endedAt
    }))
  )
  return { turns, newest: latestStructuredAgentSessionAssistantMessage(result.page.items) }
}

export type StructuredTurnReader = {
  /**
   * `found` (one host's new replies from its rows) with each structured chat's replies read from
   * its turns: whole, and with the turns that ended between two polls. `commit` keeps what was read
   * as read; a poll whose results are dropped does not call it, so nothing is lost.
   */
  replies<T extends TurnReply>(
    client: RpcClient,
    rows: readonly AutoReadAgentRow[],
    found: readonly T[]
  ): Promise<{ replies: (T | TurnReply)[]; commit: () => void }>
}

export function createStructuredTurnReader(): StructuredTurnReader {
  const panes = new Map<string, PaneTurns>()

  return {
    async replies(client, rows, found) {
      const next = new Map<string, PaneTurns>()
      const structured = new Set<string>()
      const read: TurnReply[] = []
      await Promise.all(
        rows.map(async (row) => {
          const sessionId = row.parentPaneKey ? null : structuredSessionId(row.rawPaneKey)
          if (!sessionId) {
            return
          }
          structured.add(row.paneKey)
          const start = row.mainAgent?.stateStartedAt ?? row.stateStartedAt
          const reply = found.find(({ paneKey }) => paneKey === row.paneKey)
          // First sight: only turns that end from now on, and a new agent's first reply.
          const seen = panes.get(row.paneKey) ?? {
            start: reply ? Number.NaN : start,
            after: reply ? reply.endedAt - 1 : start,
            held: null
          }
          if (start === seen.start && !reply) {
            next.set(row.paneKey, seen)
            return
          }
          // Like the row's reply: an agent that left a subagent working ends its turn with "I'll be
          // back", which waits for the turn that follows, or is read when the subagents end.
          const done = mainAgentState(row) === 'done'
          const held = done && row.subagents?.some(isRunningSubagent) ? start : null
          try {
            const page = await readTurns(client, sessionId, seen.after, done ? start : null)
            let turns = page.turns
            // A reply its turns do not show (a chat without turn rows) is the row's, whole when
            // the chat's newest reply is the one it previews.
            if (reply && held === null && !turns.some(({ endedAt }) => endedAt >= reply.endedAt)) {
              const whole = standsFor(reply.message, page.newest) ? page.newest : reply.message
              turns = [...turns, { message: whole, endedAt: reply.endedAt }]
            }
            if (held !== null) {
              turns = turns.filter(({ endedAt }) => endedAt < held)
            } else if (seen.held !== null) {
              const replaced = seen.held
              if (turns.some(({ endedAt }) => endedAt > replaced)) {
                turns = turns.filter(({ endedAt }) => endedAt !== replaced)
              }
            }
            const after = Math.max(seen.after, ...turns.map(({ endedAt }) => endedAt))
            next.set(row.paneKey, { start, after, held })
            read.push(...turns.map((turn) => ({ paneKey: row.paneKey, ...turn })))
          } catch (error) {
            logSpeechEvent(
              `structured reply ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
            )
            // The row's preview is read as before; turns that ended between polls are not.
            next.set(row.paneKey, { start, after: Math.max(seen.after, reply?.endedAt ?? 0), held })
            if (reply) {
              read.push(reply)
            }
          }
        })
      )
      return {
        replies: [
          ...found.filter(({ paneKey }) => !structured.has(paneKey)),
          ...read.sort((a, b) => a.endedAt - b.endedAt)
        ],
        commit: () => {
          for (const [paneKey, turns] of next) {
            panes.set(paneKey, turns)
          }
        }
      }
    }
  }
}
