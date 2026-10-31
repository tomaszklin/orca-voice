import { z } from 'zod'
import {
  isNativeChatSupportedAgent,
  nativeChatRequiresLocalTranscript
} from '../../../src/shared/native-chat-agent-support'
import { parsePaneKey } from '../../../src/shared/stable-pane-id'
import { sessionTabsListRead } from '../session/mobile-session-read-operations'
import type { RpcClient } from '../transport/rpc-client'

export type ChatTarget = { agent: string; sessionId: string; transcriptPath: string | null }

const tabSchema = z.looseObject({
  type: z.string(),
  id: z.string(),
  parentTabId: z.string().nullish(),
  leafId: z.string().nullish(),
  launchAgent: z.string().nullish(),
  agentStatus: z
    .looseObject({
      agentType: z.string().nullish(),
      state: z.string().nullish(),
      mainAgent: z.looseObject({ state: z.string().nullish() }).nullish(),
      providerSession: z
        .looseObject({ id: z.string().nullish(), transcriptPath: z.string().nullish() })
        .nullish()
    })
    .nullish()
})
export type Tab = z.infer<typeof tabSchema>

function tabsOf(result: unknown): Tab[] {
  const tabs = z.looseObject({ tabs: z.array(z.unknown()) }).safeParse(result)
  if (!tabs.success) {
    return []
  }
  return tabs.data.tabs.flatMap((tab) => {
    const parsed = tabSchema.safeParse(tab)
    return parsed.success ? [parsed.data] : []
  })
}

export async function readWorktreeTabs(client: RpcClient, worktreeId: string): Promise<Tab[]> {
  const response = await sessionTabsListRead.request(client, { worktree: `id:${worktreeId}` })
  return tabsOf(sessionTabsListRead.interpret(response))
}

export function tabForPane(tabs: readonly Tab[], rawPaneKey: string): Tab | null {
  const pane = parsePaneKey(rawPaneKey)
  if (!pane) {
    return null
  }
  return (
    tabs.find(
      (candidate) =>
        candidate.type === 'terminal' &&
        (candidate.parentTabId ?? candidate.id) === pane.tabId &&
        candidate.leafId === pane.leafId
    ) ?? null
  )
}

/** The transcript a terminal pane's chat reads, by the rules of `resolveMobileNativeChat`. */
export function chatTargetForPane(tabs: readonly Tab[], rawPaneKey: string): ChatTarget | null {
  const tab = tabForPane(tabs, rawPaneKey)
  if (!tab) {
    return null
  }
  const liveAgent = tab.agentStatus?.agentType ?? null
  const agent = liveAgent ?? tab.launchAgent ?? null
  // Agents read from the phone's own disk (no hook-reported path) are left to final replies.
  if (!agent || !isNativeChatSupportedAgent(agent) || nativeChatRequiresLocalTranscript(agent)) {
    return null
  }
  const sessionId = tab.agentStatus?.providerSession?.id
  if (!sessionId) {
    return null
  }
  return {
    agent,
    sessionId,
    transcriptPath: tab.agentStatus?.providerSession?.transcriptPath ?? null
  }
}
