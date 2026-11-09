import { isKnownHarnessInjectedUserTurnText } from '../../../src/shared/harness-injected-user-turns'
import {
  DEFAULT_OTHER_TURN_REPLIES,
  OTHER_TURN_REPLIES_KEY,
  type OtherTurnReplies
} from '../storage/speech-preferences'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import type { AutoReadAgentRow } from './auto-read-agent-rows'
import { chatTargetForPane, readWorktreeTabs, type Tab } from './chat-feed-target'
import { readTail, type TailMessage } from './nested-session-guard'
import { createStoredChoice } from './stored-choice'

/**
 * Orca Voice fork: a final reply is read only when it answers the owner's own message (owner's
 * request, 2026-11-01, after four replies in a row: to a background build ending and to two
 * messages from another Claude session).
 *
 * A background task's notice shows in the transcript as a user message with a harness tag. A
 * message from another session is hidden from it (Claude marks it as meta), so it shows only as a
 * second final reply after the same prompt. Without a readable transcript the reply is read.
 */
export const useOtherTurnReplies = createStoredChoice<OtherTurnReplies>(
  OTHER_TURN_REPLIES_KEY,
  ['on', 'off'],
  DEFAULT_OTHER_TURN_REPLIES
)

// Why: a long turn pushes its prompt far back; a prompt outside the tail counts as unknown.
const PROMPT_SEARCH_MESSAGES = 40

export type TurnPrompt = { id: string; fromUser: boolean }

function messageText(message: TailMessage): string {
  return message.blocks
    .flatMap((block) => (typeof block.text === 'string' ? [block.text] : []))
    .join('\n')
}

/** The message that started the transcript's latest turn, or null when the tail has none. */
export function latestPrompt(messages: readonly TailMessage[]): TurnPrompt | null {
  const prompt = messages.findLast(({ role }) => role === 'user')
  if (!prompt) {
    return null
  }
  const id = typeof prompt.id === 'string' ? prompt.id : ''
  return { id, fromUser: !isKnownHarnessInjectedUserTurnText(messageText(prompt)) }
}

export type UserTurnGuard = {
  /** The replies that answer the owner's own messages; `rows` are one host's current agent rows. */
  userReplies<T extends { paneKey: string }>(
    client: RpcClient,
    rows: readonly AutoReadAgentRow[],
    replies: readonly T[]
  ): Promise<T[]>
}

export function createUserTurnGuard(): UserTurnGuard {
  // The prompt each pane's last read reply answered.
  const answered = new Map<string, string>()

  const answersUser = async (
    client: RpcClient,
    paneKey: string,
    tabs: Tab[],
    rawPaneKey: string
  ) => {
    const target = chatTargetForPane(tabs, rawPaneKey)
    const tail = target ? await readTail(client, target, PROMPT_SEARCH_MESSAGES) : null
    const prompt = tail ? latestPrompt(tail) : null
    if (!prompt || !prompt.id) {
      return true
    }
    if (!prompt.fromUser || answered.get(paneKey) === prompt.id) {
      return false
    }
    answered.set(paneKey, prompt.id)
    return true
  }

  return {
    async userReplies(client, rows, replies) {
      const replying = new Set(replies.map(({ paneKey }) => paneKey))
      const skipped = new Set<string>()
      const wanted = rows.filter((row) => replying.has(row.paneKey))
      for (const worktreeId of new Set(wanted.flatMap((row) => row.worktreeId ?? []))) {
        let tabs: Tab[]
        try {
          tabs = await readWorktreeTabs(client, worktreeId)
        } catch {
          continue
        }
        for (const row of wanted.filter((candidate) => candidate.worktreeId === worktreeId)) {
          if (!(await answersUser(client, row.paneKey, tabs, row.rawPaneKey))) {
            skipped.add(row.paneKey)
          }
        }
      }
      return replies.filter(({ paneKey }) => !skipped.has(paneKey))
    }
  }
}
