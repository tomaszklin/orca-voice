import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { withoutNativeChatVisualDirectiveLines } from '../../../src/shared/native-chat-visual-directive'
import { useRpcClientContext } from '../transport/client-context'
import type { RpcClient } from '../transport/rpc-client'
import { useAutoReadRepliesPreference } from './auto-read-preference'
import { useBackgroundReadingPreference, useBackgroundReadingService } from './background-reading'
import { backgroundReadingActive } from './background-reading-state'
import { speakReply } from './reply-speaker'
import { recordSpeechDiagnostics } from './speech-diagnostics'

// Five times slower than the workspace list's own worktree.ps polling, to spare the battery while
// the background service keeps reading with the screen off (owner's choice, 2026-10-19): a reply
// is spoken within about 15 seconds of the agent finishing.
const POLL_INTERVAL_MS = 15_000

export type ReplyBaseline = ReadonlyMap<string, string>

export type NewReply = { paneKey: string; message: string }

/**
 * Compares the agents' finished replies against what was already seen.
 *
 * A pane seen for the first time only records its current reply (empty while a turn is running),
 * so turning auto-read on or reconnecting never reads out old replies, while a brand-new agent's
 * first finished turn still counts as new. Subagent rows are skipped: their
 * replies are steps of the parent's turn, not answers to the user.
 */
export function findNewReplies(
  baseline: ReplyBaseline,
  agents: readonly RuntimeWorktreeAgentRow[]
): { baseline: ReplyBaseline; newReplies: NewReply[] } {
  const next = new Map(baseline)
  const newReplies: NewReply[] = []
  for (const agent of agents) {
    if (agent.parentPaneKey) {
      continue
    }
    // The main agent's own state, not the row's: a session whose agent left a background task
    // running (a dev server, a long build) keeps the row `working` after its turn has ended, while
    // `mainAgent.state` is already `done`. And it must be `done`: mid-turn the host also puts tool
    // output (web search results, a file it read) in `lastAssistantMessage`, which is not a reply.
    // Hosts too old to send `mainAgent` fall back to the row's state.
    const turnState = agent.mainAgent?.state ?? agent.state
    const finished =
      turnState === 'done' && agent.lastAssistantMessage ? agent.lastAssistantMessage : null
    const seen = next.get(agent.paneKey)
    if (seen === undefined) {
      next.set(agent.paneKey, finished ?? '')
      continue
    }
    if (finished && finished !== seen) {
      next.set(agent.paneKey, finished)
      newReplies.push({ paneKey: agent.paneKey, message: finished })
    }
  }
  return { baseline: next, newReplies }
}

/** The agent rows of one worktree.ps reply, with pane keys made unique across hosts. */
export function agentRowsFromWorktreePs(
  hostId: string,
  result: unknown
): RuntimeWorktreeAgentRow[] {
  const worktrees = (result as { worktrees?: unknown } | null)?.worktrees
  if (!Array.isArray(worktrees)) {
    return []
  }
  const rows: RuntimeWorktreeAgentRow[] = []
  for (const worktree of worktrees) {
    const agents = (worktree as { agents?: unknown } | null)?.agents
    if (!Array.isArray(agents)) {
      continue
    }
    for (const agent of agents as RuntimeWorktreeAgentRow[]) {
      if (typeof agent?.paneKey !== 'string') {
        continue
      }
      rows.push({
        ...agent,
        paneKey: `${hostId}:${agent.paneKey}`,
        parentPaneKey: agent.parentPaneKey ? `${hostId}:${agent.parentPaneKey}` : null
      })
    }
  }
  return rows
}

async function readAgentRows(
  hostId: string,
  client: RpcClient
): Promise<RuntimeWorktreeAgentRow[]> {
  const response = await client.sendRequest('worktree.ps', {})
  if (!response.ok) {
    throw new Error(`worktree.ps refused: ${response.error.code}`)
  }
  return agentRowsFromWorktreePs(hostId, response.result)
}

/**
 * Reads each newly finished agent reply aloud while the auto-read setting is on.
 *
 * Runs in the native shell, not in the page the desktop serves: it asks every connected host for
 * its agent rows over the shell's own clients, so it works on any screen, list or chat alike.
 */
export function useAutoReadReplies(): void {
  const rpc = useRpcClientContext()
  const { autoRead } = useAutoReadRepliesPreference()
  const { backgroundReading } = useBackgroundReadingPreference()
  const baselineRef = useRef<ReplyBaseline>(new Map())
  // The background service's ticks reach the current poll through this, since JS timers stop
  // firing once Orca is off screen.
  const pollRef = useRef<() => void>(() => undefined)
  const onServiceTick = useCallback(() => pollRef.current(), [])
  useBackgroundReadingService(autoRead && backgroundReading, onServiceTick)

  useEffect(() => {
    if (!autoRead) {
      return
    }
    // Why: a fresh baseline each time auto-read is switched on, so replies that arrived while
    // it was off are not read out in a burst.
    baselineRef.current = new Map()
    let cancelled = false
    let inFlight = false
    let lastPollAt = 0

    const poll = async () => {
      const now = Date.now()
      // The interval and the service ticks both land here; one read per window is enough.
      if (inFlight || now - lastPollAt < POLL_INTERVAL_MS - 500) {
        return
      }
      if (AppState.currentState !== 'active' && !backgroundReadingActive()) {
        return
      }
      inFlight = true
      lastPollAt = now
      try {
        const known = rpc.getAllClients()
        const connected = known.filter(({ client }) => client.getState() === 'connected')
        let lastError: string | null = null
        const rows = await Promise.all(
          connected.map(({ hostId, client }) =>
            readAgentRows(hostId, client).catch((error: unknown) => {
              lastError = error instanceof Error ? error.message : String(error)
              return null
            })
          )
        )
        if (cancelled) {
          return
        }
        // A host whose read failed this round is left out rather than treated as having no
        // agents, so its panes keep their baseline and nothing is re-read when it answers again.
        const agents = rows.flatMap((hostRows) => hostRows ?? [])
        const { baseline, newReplies } = findNewReplies(baselineRef.current, agents)
        baselineRef.current = baseline
        recordSpeechDiagnostics({
          lastPollAt: Date.now(),
          knownHosts: known.length,
          connectedHosts: connected.length,
          agentRows: agents.length,
          newReplies: newReplies.length,
          ...(newReplies.length > 0 ? { lastNewReplyAt: Date.now() } : {}),
          ...(lastError ? { lastError } : {})
        })
        for (const reply of newReplies) {
          speakReply(reply.paneKey, withoutNativeChatVisualDirectiveLines(reply.message), 'queue')
        }
      } catch (error) {
        recordSpeechDiagnostics({
          lastPollAt: Date.now(),
          lastError: error instanceof Error ? error.message : String(error)
        })
      } finally {
        inFlight = false
      }
    }

    pollRef.current = () => void poll()
    void poll()
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
      pollRef.current = () => undefined
    }
  }, [autoRead, rpc])
}
