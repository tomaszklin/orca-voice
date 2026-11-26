import { isRootAgentJournalItem } from '../../../src/shared/agent-session/journal/agent-session-journal-producer'
import type { AgentJournalRenderItem } from '../../../src/shared/agent-session/journal/agent-session-journal-types'
import { assistantProse } from '../../../src/shared/agent-session/requests/structured-agent-session-assistant-prose'
import { withoutNativeChatVisualDirectiveLines } from '../../../src/shared/native-chat/visuals/native-chat-visual-directive'
import { callAgentSession } from '../session/native-chat/agent-session/mobile-structured-agent-session-rpc'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'

// Orca Voice fork: a chat's messages for the car's session view, newest first (owner, 2026-11-26).

export type CarHistoryMessage = {
  id: string
  fromUser: boolean
  at: number
  markdown: string
  /** The host sent a shortened copy; the whole one is read before it is spoken. */
  shortened: boolean
}

// The host bounds the page by bytes too, keeping the newest items.
const HISTORY_ITEMS = 80
const HISTORY_LIMIT = 30
const READ_TIMEOUT_MS = 10_000

function messageText(item: AgentJournalRenderItem): string {
  const { body } = item
  if (!isRootAgentJournalItem(item) || body.kind !== 'message' || body.command) {
    return ''
  }
  if (body.role === 'assistant') {
    return withoutNativeChatVisualDirectiveLines(assistantProse(body.blocks))
  }
  if (body.role !== 'user') {
    return ''
  }
  return body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
}

/** The user's messages and the agent's own replies, newest first, without subagents and tools. */
export function carHistoryFromItems(items: readonly AgentJournalRenderItem[]): CarHistoryMessage[] {
  const messages: CarHistoryMessage[] = []
  for (let index = items.length - 1; index >= 0 && messages.length < HISTORY_LIMIT; index -= 1) {
    const item = items[index]!
    const markdown = messageText(item)
    if (markdown.trim()) {
      messages.push({
        id: item.itemId,
        fromUser: item.body.kind === 'message' && item.body.role === 'user',
        at: item.observedAt,
        markdown,
        shortened: item.shortened === true
      })
    }
  }
  return messages
}

export async function readCarHistory(
  client: RpcClient,
  sessionId: string
): Promise<CarHistoryMessage[]> {
  const result = await callAgentSession<{ page?: { items?: AgentJournalRenderItem[] } }>(
    client,
    'agentSession.history',
    { sessionId, direction: 'tail', limit: HISTORY_ITEMS },
    READ_TIMEOUT_MS
  )
  return carHistoryFromItems(result.page?.items ?? [])
}

/** The message whole, when the page carried a shortened copy. */
export async function wholeCarMessage(
  client: RpcClient,
  sessionId: string,
  message: CarHistoryMessage
): Promise<string> {
  if (!message.shortened) {
    return message.markdown
  }
  const { item } = await callAgentSession<{ item: AgentJournalRenderItem | null }>(
    client,
    'agentSession.item',
    { sessionId, itemId: message.id },
    READ_TIMEOUT_MS
  )
  const whole = item ? messageText(item) : ''
  return whole.trim() ? whole : message.markdown
}
