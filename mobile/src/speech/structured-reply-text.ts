import { isRootAgentJournalItem } from '../../../src/shared/agent-session-journal-producer'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session-journal-types'
import type { AgentSessionHistoryResult } from '../../../src/shared/agent-session-wire'
import {
  AGENT_STATUS_MAX_FIELD_LENGTH,
  normalizeOptionalField
} from '../../../src/shared/agent-status-field-normalization'
import { latestStructuredAgentSessionAssistantMessage } from '../../../src/shared/structured-agent-session-latest-request'
import { callAgentSession } from '../session/mobile-structured-agent-session-rpc'
import type { RpcClient } from '../transport/rpc-client'
import { logSpeechEvent } from './speech-diagnostics'

/**
 * Orca Voice fork: the whole final reply of a structured chat (Orca's own agent chat, not a
 * terminal). Its `worktree.ps` row carries only a one-line preview of 200 characters, so auto-read
 * stopped mid-sentence and went on to the next message, while the Read button, which reads the
 * chat, read it all (owner, 2026-11-03). The reply is read from the end of the chat's history.
 */

const PANE_PREFIX = 'structured-agent-session-'
// The reply is the newest root-agent message; a subagent's rows after it are few.
const TAIL_ITEMS = 40
const READ_TIMEOUT_MS = 10_000

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

/** The page's items, with the newest reply whole when the page carried a shortened copy. */
async function wholeItems(
  client: RpcClient,
  sessionId: string,
  items: readonly AgentJournalRenderItem[]
): Promise<readonly AgentJournalRenderItem[]> {
  const at = items.findLastIndex(isReply)
  const reply = items[at]
  if (!reply?.shortened) {
    return items
  }
  const { item } = await callAgentSession<{ item: AgentJournalRenderItem | null }>(
    client,
    'agentSession.item',
    { sessionId, itemId: reply.itemId },
    READ_TIMEOUT_MS
  )
  return item ? items.map((each, index) => (index === at ? item : each)) : items
}

/**
 * The reply `preview` stands for, read whole; `preview` itself when the chat cannot be read or
 * its newest reply is another one.
 */
export async function wholeStructuredReply(
  client: RpcClient,
  sessionId: string,
  preview: string
): Promise<string> {
  try {
    const result = await callAgentSession<AgentSessionHistoryResult>(
      client,
      'agentSession.history',
      { sessionId, direction: 'tail', limit: TAIL_ITEMS },
      READ_TIMEOUT_MS
    )
    const items = await wholeItems(client, sessionId, result.page.items)
    const reply = latestStructuredAgentSessionAssistantMessage(items)
    if (reply && standsFor(preview, reply)) {
      return reply
    }
    logSpeechEvent(`structured reply ${sessionId}: the chat's newest reply is another one`)
  } catch (error) {
    logSpeechEvent(
      `structured reply ${sessionId}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  return preview
}

/** `replies` with the structured chats' previews replaced by their whole text. */
export async function withWholeStructuredReplies<T extends { paneKey: string; message: string }>(
  client: RpcClient,
  rows: readonly { paneKey: string; rawPaneKey: string }[],
  replies: readonly T[]
): Promise<T[]> {
  return Promise.all(
    replies.map(async (reply) => {
      const row = rows.find(({ paneKey }) => paneKey === reply.paneKey)
      const sessionId = row ? structuredSessionId(row.rawPaneKey) : null
      if (!sessionId) {
        return reply
      }
      const message = await wholeStructuredReply(client, sessionId, reply.message)
      return message === reply.message ? reply : { ...reply, message }
    })
  )
}
