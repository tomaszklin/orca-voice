import { z } from 'zod'
import { mainAgentState } from '../../../src/shared/main-agent-status'
import { nativeChatSessionPageRead } from '../session/mobile-session-read-operations'
import type { RpcClient } from '../transport/rpc-client'
import type { AutoReadAgentRow } from './auto-read-agent-rows'
import {
  chatTargetForPane,
  readWorktreeTabs,
  tabForPane,
  type ChatTarget,
  type Tab
} from './chat-feed-target'

/**
 * Orca Voice fork: tells a pane's own agent from a `claude -p` that agent started.
 *
 * A nested run inherits the pane's identity, so its hooks reach the host as that pane: the row
 * reads `done` with the nested reply and the pane reports the nested session (measured 2026-10-31,
 * when a plugin's end-to-end tests were read out as final replies). The host guards only Codex and
 * Grok against this. So a reply counts as nested on evidence alone: the pane's own session is
 * waiting on a tool call. Without evidence the reply is read: a lost answer costs more than a
 * stray one.
 */

const TAIL_MESSAGES = 12
const READ_TIMEOUT_MS = 5_000
// Why: agents without a readable session are asked for at most this often during a turn.
const UNRESOLVED_RETRY_MS = 10_000

const tailSchema = z.looseObject({
  messages: z.array(
    z.looseObject({
      role: z.string(),
      blocks: z.array(z.looseObject({ type: z.string() })).catch([])
    })
  )
})
type TailMessage = z.infer<typeof tailSchema>['messages'][number]

/** Whether a transcript ends on a tool call or its result: the agent has not finished its turn. */
export function endsMidTurn(messages: readonly TailMessage[]): boolean {
  const last = messages.findLast(({ role }) => role !== 'system' && role !== 'reasoning')
  return (
    last !== undefined &&
    (last.role === 'tool' ||
      last.blocks.some(({ type }) => type === 'tool-call' || type === 'tool-result'))
  )
}

/** Whether a transcript took more than one prompt, which a one-shot `claude -p` never does. */
export function hasSeveralTurns(messages: readonly TailMessage[]): boolean {
  return messages.filter(({ role }) => role === 'user').length > 1
}

async function readTail(client: RpcClient, target: ChatTarget): Promise<TailMessage[] | null> {
  try {
    const response = await nativeChatSessionPageRead.request(
      client,
      {
        agent: target.agent,
        sessionId: target.sessionId,
        limit: TAIL_MESSAGES,
        capabilities: { transcriptSourceOrder: 1 },
        ...(target.transcriptPath ? { transcriptPath: target.transcriptPath } : {})
      },
      { timeoutMs: READ_TIMEOUT_MS }
    )
    const accepted = nativeChatSessionPageRead.interpret(response)
    const tail = accepted.accepted ? tailSchema.safeParse(accepted.value) : null
    return tail?.success ? tail.data.messages : null
  } catch {
    return null
  }
}

export type NestedSessionGuard = {
  /** The replies the panes' own agents wrote; `rows` are one host's current agent rows. */
  ownReplies<T extends { paneKey: string }>(
    client: RpcClient,
    rows: readonly AutoReadAgentRow[],
    replies: readonly T[]
  ): Promise<T[]>
  /** Whether a pane's reported session is a run its own agent started. */
  isNested(client: RpcClient, paneKey: string, target: ChatTarget): Promise<boolean>
}

export function createNestedSessionGuard(): NestedSessionGuard {
  // The session each pane's agent runs in, from before a nested run could report over it.
  const homes = new Map<string, ChatTarget>()
  const lastLook = new Map<string, number>()

  const isNested: NestedSessionGuard['isNested'] = async (client, paneKey, target) => {
    const home = homes.get(paneKey)
    if (!home || home.sessionId === target.sessionId) {
      return false
    }
    const homeTail = await readTail(client, home)
    if (!homeTail || !endsMidTurn(homeTail)) {
      return false
    }
    // Why: an agent killed during a tool call looks mid-turn for good, and its pane's next session
    // must not stay silent; a second prompt shows that session is no one-shot run.
    const tail = await readTail(client, target)
    return !tail || !hasSeveralTurns(tail)
  }

  const isOwnReply = async (
    client: RpcClient,
    paneKey: string,
    target: ChatTarget,
    paneWorking: boolean
  ): Promise<boolean> => {
    const home = homes.get(paneKey)
    // Why: the nested run may have ended since the row was read, so the pane is back in its own
    // session with the nested reply still on the row.
    if (home?.sessionId === target.sessionId && paneWorking) {
      const tail = await readTail(client, home)
      return !tail || !endsMidTurn(tail)
    }
    if (await isNested(client, paneKey, target)) {
      return false
    }
    homes.set(paneKey, target)
    return true
  }

  return {
    async ownReplies(client, rows, replies) {
      const now = Date.now()
      const replying = new Set(replies.map(({ paneKey }) => paneKey))
      // Why: a session's first long turn has no reply yet to learn the pane's session from.
      const learning = (row: AutoReadAgentRow) =>
        !homes.has(row.paneKey) &&
        mainAgentState(row) === 'working' &&
        now - (lastLook.get(row.paneKey) ?? 0) >= UNRESOLVED_RETRY_MS
      const wanted = rows.filter((row) => replying.has(row.paneKey) || learning(row))
      const nested = new Set<string>()
      for (const worktreeId of new Set(wanted.flatMap((row) => row.worktreeId ?? []))) {
        let tabs: Tab[]
        try {
          tabs = await readWorktreeTabs(client, worktreeId)
        } catch {
          continue
        }
        for (const row of wanted.filter((candidate) => candidate.worktreeId === worktreeId)) {
          lastLook.set(row.paneKey, now)
          const target = chatTargetForPane(tabs, row.rawPaneKey)
          if (!target) {
            continue
          }
          if (!replying.has(row.paneKey)) {
            homes.set(row.paneKey, target)
            continue
          }
          const status = tabForPane(tabs, row.rawPaneKey)?.agentStatus
          const working = (status?.mainAgent?.state ?? status?.state) === 'working'
          if (!(await isOwnReply(client, row.paneKey, target, working))) {
            nested.add(row.paneKey)
          }
        }
      }
      return replies.filter(({ paneKey }) => !nested.has(paneKey))
    },
    isNested
  }
}
