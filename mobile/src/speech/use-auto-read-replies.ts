import { useCallback, useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { mainAgentState } from '../../../src/shared/main-agent-status'
import { withoutNativeChatVisualDirectiveLines } from '../../../src/shared/native-chat/native-chat-visual-directive'
import { useRpcClientContext } from '../transport/client-context'
import {
  findNewWaits,
  useAnnounceWaits,
  waitAnnouncement,
  type WaitBaseline
} from './agent-wait-announcement'
import { agentPanes, readAgentRows, type SpokenAgentRow } from './auto-read-agent-rows'
import { useAutoReadRepliesPreference } from './auto-read-preference'
import { useBackgroundReadingPreference, useBackgroundReadingService } from './background-reading'
import { backgroundReadingActive } from './background-reading-state'
import { createChatMessageFeeds } from './chat-message-feeds'
import {
  chimeBeforeMessage,
  projectNameIntro,
  useChimeMode,
  useProjectNameMode,
  type LastReadMessage
} from './project-name-announcement'
import { createNestedSessionGuard } from './nested-session-guard'
import { useReadScopePreference } from './read-scope-preference'
import { expireHolds, speakReply, stopAutoReading } from './reply-speaker'
import { logSpeechEvent } from './speech-diagnostics'

// On screen, as often as the workspace list's own worktree.ps polling; with the screen off, five
// times slower to spare the battery while the background service keeps reading (owner's choices,
// 2026-10-19 and 2026-10-21). A reply is spoken within about 3 or 15 seconds of the agent finishing.
const FOREGROUND_POLL_MS = 3_000
const BACKGROUND_POLL_MS = 15_000
// Why: request timeouts are JS timers, which pause off screen, so a poll stuck this long is replaced.
const STUCK_POLL_MS = 60_000

export type ReplyBaseline = ReadonlyMap<string, string>

/** `endedAt` is when the reply's turn ended, by the host's clock. */
export type NewReply = { paneKey: string; message: string; endedAt: number }

const isRunningSubagent = ({ state }: { state: string }) =>
  state === 'working' || state === 'blocked' || state === 'waiting'

/**
 * Compares the agents' finished replies against what was already seen.
 *
 * The first look at a host only records its panes' replies, so turning auto-read on or a host
 * connecting never reads out old replies. After that, a pane seen for the first time is a new
 * agent, and its reply counts even when its whole turn ended between two polls (2026-10-28: a
 * quick first answer was skipped). A reply is its text and the moment its turn ended, so the same
 * answer given again is read again. Subagent rows are skipped: their replies are steps of the
 * parent's turn, not answers to the user.
 */
export function findNewReplies(
  baseline: ReplyBaseline,
  agents: readonly SpokenAgentRow[],
  hostSeenBefore = false
): { baseline: ReplyBaseline; newReplies: NewReply[] } {
  const next = new Map(baseline)
  const newReplies: NewReply[] = []
  for (const agent of agents) {
    // Why: subagent replies are steps of the parent's turn, not answers to the user.
    if (agent.parentPaneKey) {
      continue
    }
    // The main agent's own state, not the row's: a session whose agent left a background task
    // running (a dev server, a long build) keeps the row `working` after its turn has ended, while
    // `mainAgent.state` is already `done`. And it must be `done`: mid-turn the host also puts tool
    // output (web search results, a file it read) in `lastAssistantMessage`, which is not a reply.
    // Hosts too old to send `mainAgent` fall back to the row's state (`mainAgentState`).
    const finished =
      mainAgentState(agent) === 'done' && agent.lastAssistantMessage
        ? agent.lastAssistantMessage
        : null
    const endedAt = agent.mainAgent?.stateStartedAt ?? agent.stateStartedAt
    const key = finished === null ? '' : `${endedAt}\n${finished}`
    const seen = next.get(agent.paneKey)
    if (seen === undefined && !hostSeenBefore) {
      next.set(agent.paneKey, key)
      continue
    }
    // Why: an agent that left a subagent working ends its turn with "I'll be back" and wakes when
    // the subagent ends. Left unrecorded, so the text is still read if that turn never comes.
    if (finished !== null && agent.subagents?.some(isRunningSubagent)) {
      continue
    }
    if (finished !== null && key !== seen) {
      next.set(agent.paneKey, key)
      newReplies.push({ paneKey: agent.paneKey, message: finished, endedAt })
    } else if (seen === undefined) {
      next.set(agent.paneKey, key)
    }
  }
  return { baseline: next, newReplies }
}

/** The latest value, read when a message arrives, so a changed choice applies at once. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref
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
  const readScopeRef = useLatest(useReadScopePreference().readScope)
  const projectNameModeRef = useLatest(useProjectNameMode().value)
  const chimeModeRef = useLatest(useChimeMode().value)
  const announceWaitsRef = useLatest(useAnnounceWaits().value)
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
    // Hosts whose panes are in the baseline; a host's first look only records them.
    const hostsSeen = new Set<string>()
    let cancelled = false
    // Why: a poll that replaced a stuck one makes the stuck one's late results stale.
    let generation = 0
    let inFlightSince: number | null = null
    let lastPollAt = 0
    // The project of each pane, from the latest poll; and the last message queued, for `on-change`.
    let projectByPane: ReadonlyMap<string, string | null> = new Map()
    let lastRead: LastReadMessage | null = null
    // Fresh with the reply baseline, so waits that began while auto-read was off are not announced.
    let waitBaseline: WaitBaseline = new Map()
    const speakAutoRead = (id: string, paneKey: string, text: string) => {
      const project = projectByPane.get(paneKey) ?? null
      const now = Date.now()
      const intro = {
        chime: chimeBeforeMessage(chimeModeRef.current, project, lastRead, now),
        name: projectNameIntro(projectNameModeRef.current, project, lastRead, now),
        title: project
      }
      lastRead = { project, at: now }
      speakReply(id, text, 'queue', intro)
    }
    const readsEveryMessage = () =>
      readScopeRef.current === 'all' ||
      (readScopeRef.current === 'all-on-screen' && AppState.currentState === 'active')
    const nestedSessions = createNestedSessionGuard()
    const feeds = createChatMessageFeeds((paneKey, messageId, text) => {
      if (!readsEveryMessage()) {
        return false
      }
      speakAutoRead(`${paneKey}#${messageId}`, paneKey, text)
      return true
    }, nestedSessions.isNested)

    const poll = async () => {
      const now = Date.now()
      expireHolds(now)
      const onScreen = AppState.currentState === 'active'
      if (!onScreen && !backgroundReadingActive()) {
        return
      }
      // The interval and the service ticks both land here; half an interval dedupes them without
      // skipping a tick that comes a little early. A check in flight longer than STUCK_POLL_MS is
      // taken as hung and replaced.
      const interval = onScreen ? FOREGROUND_POLL_MS : BACKGROUND_POLL_MS
      const busy = inFlightSince !== null && now - inFlightSince < STUCK_POLL_MS
      if (busy || now - lastPollAt < interval / 2) {
        return
      }
      if (inFlightSince !== null) {
        logSpeechEvent('check stuck, starting a new one')
      }
      const run = ++generation
      inFlightSince = now
      lastPollAt = now
      try {
        const known = rpc.getAllClients()
        feeds.keepHosts(new Set(known.map(({ hostId }) => hostId)))
        const connected = known.filter(({ client }) => client.getState() === 'connected')
        const rows = await Promise.all(
          connected.map(({ hostId, client }) => readAgentRows(hostId, client).catch(() => null))
        )
        if (cancelled || run !== generation) {
          return
        }
        // A host whose read failed this round is left out rather than treated as having no
        // agents, so its panes keep their baseline and nothing is re-read when it answers again.
        const agents = rows.flatMap((hostRows) => hostRows ?? [])
        // Merged, not replaced: a host whose read failed this round keeps its panes' projects.
        projectByPane = new Map([
          ...projectByPane,
          ...agents.map((row) => [row.paneKey, row.project] as const)
        ])
        const newReplies: NewReply[] = []
        for (const [index, { hostId, client }] of connected.entries()) {
          const hostRows = rows[index]
          if (!hostRows) {
            continue
          }
          const found = findNewReplies(baselineRef.current, hostRows, hostsSeen.has(hostId))
          baselineRef.current = found.baseline
          hostsSeen.add(hostId)
          newReplies.push(...(await nestedSessions.ownReplies(client, hostRows, found.newReplies)))
        }
        if (cancelled || run !== generation) {
          return
        }
        const feedsReading = readsEveryMessage()
        for (const reply of feeds.overdue(feedsReading)) {
          speakAutoRead(reply.id, reply.paneKey, reply.text)
        }
        for (const reply of newReplies) {
          const message = withoutNativeChatVisualDirectiveLines(reply.message)
          // One id per turn, not per pane: while auto-read is paused, a pane's second reply would
          // otherwise replace its first in the reader's queue.
          const id = `${reply.paneKey}@${reply.endedAt}`
          if (feeds.heard(reply.paneKey, message)) {
            continue
          }
          // The pane's feed reads this pane's messages itself, the final one included (into the
          // queue while auto-read is paused). Held, so it is still read should the feed miss it.
          if (feedsReading && feeds.covers(reply.paneKey)) {
            feeds.awaitReply({ id, paneKey: reply.paneKey, text: message })
            continue
          }
          speakAutoRead(id, reply.paneKey, message)
        }
        const waits = findNewWaits(waitBaseline, agents)
        waitBaseline = waits.baseline
        if (announceWaitsRef.current === 'on') {
          for (const wait of waits.newWaits) {
            const id = `${wait.paneKey}~wait~${wait.since}`
            speakAutoRead(id, wait.paneKey, waitAnnouncement(wait.kind))
          }
        }
        if (readScopeRef.current === 'replies') {
          feeds.closeAll()
        } else {
          await Promise.all(
            connected.map(({ hostId, client }, index) => {
              const hostRows = rows[index]
              return hostRows
                ? feeds
                    .sync(hostId, client, agentPanes(hostRows), Date.now())
                    .catch(() => undefined)
                : undefined
            })
          )
          // A feed opened while auto-read was being switched off would outlive the cleanup.
          if (cancelled) {
            feeds.closeAll()
          }
        }
      } catch (error) {
        logSpeechEvent(`check failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        if (run === generation) {
          inFlightSince = null
        }
      }
    }

    pollRef.current = () => void poll()
    void poll()
    const timer = setInterval(() => void poll(), FOREGROUND_POLL_MS)
    // Why: without screen-off reading, auto-read ends with the screen, as its setting says.
    const leaving = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !backgroundReadingActive()) {
        stopAutoReading('left the screen without screen-off reading')
      }
    })
    return () => {
      cancelled = true
      clearInterval(timer)
      leaving.remove()
      feeds.closeAll()
      pollRef.current = () => undefined
    }
  }, [autoRead, rpc])
}
