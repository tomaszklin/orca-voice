import { useEffect, useSyncExternalStore } from 'react'
import { mainAgentState } from '../../../src/shared/agent-status/lifecycle/main-agent-status'
import { parseOrcaSessionAddress } from '../../../src/shared/agent-session/identity/orca-session-address'
import { loadStoredHostProfiles } from '../host-catalog/host-metadata-store'
import { useRpcClientContext } from '../transport/connection/client-context'
import { latestHostWorktrees, type AutoReadAgentRow } from './auto-read-agent-rows'
import { setCarSessionActive } from './background-reading-state'
import { loadCarHistory, readForCar, refreshCarHistory } from './car-history-store'
import { newSessionFromCar } from './car-new-session'
import { carProjects } from './car-projects'
import { replyFromCar } from './car-replies'
import {
  carMessages as messages,
  carSessions as sessions,
  carSnippet as snippet,
  type HostClient
} from './car-sessions'
import { readerLanguage } from './reader-words'
import { speakReply } from './reply-speaker'
import { structuredSessionId } from './structured-reply-text'
import { logSpeechEvent } from './speech-diagnostics'
import { voiceNativeModule } from './voice-native-module'

// Orca Voice fork: what Orca's Android Auto screens show (OrcaCarApp.kt, CarMediaBrowser.kt), and their requests.

const HOST_NAMES_EVERY_MS = 60_000

let hostNames = new Map<string, string>()
let hostNamesAt = 0
let lastRows: readonly AutoReadAgentRow[] = []
let lastHosts: readonly HostClient[] = []
// The session the car follows live: its messages are read, and only its.
let live: string | null = null
let autoReadOn = false
let carSession = false
// Where a new chat from the car goes: each host's project's worktree.
const projectWorktrees = new Map<string, string>()
const projectKey = (hostId: string, project: string) => `${hostId}\u001f${project}`
const carSessionListeners = new Set<() => void>()

/** Notes an agent's message for the car; false when the car's choices keep it from being read. */
export function carLetsRead(paneKey: string, markdown: string, agentMessage: boolean): boolean {
  if (agentMessage) {
    messages.note(paneKey, markdown)
  }
  return live === null ? autoReadOn : paneKey === live
}

function refreshHostNames(): void {
  if (Date.now() - hostNamesAt < HOST_NAMES_EVERY_MS) {
    return
  }
  hostNamesAt = Date.now()
  void loadStoredHostProfiles()
    .then((profiles) => {
      hostNames = new Map((profiles ?? []).map((profile) => [profile.id, profile.name]))
    })
    .catch(() => undefined)
}

/** Sends the car its computers, sessions (most recently active first) and latest messages. */
export function publishCarData(
  rows: readonly AutoReadAgentRow[],
  hosts: readonly HostClient[]
): void {
  lastRows = rows
  lastHosts = hosts
  const native = voiceNativeModule()
  if (!native) {
    return
  }
  refreshHostNames()
  // Most recent work first; the car lists projects in the order their sessions come.
  const lastActive = (row: AutoReadAgentRow) =>
    Math.max(row.updatedAt ?? 0, row.mainAgent?.stateStartedAt ?? row.stateStartedAt)
  const sessionRows = rows
    .filter((row) => !row.parentPaneKey)
    .sort((a, b) => lastActive(b) - lastActive(a))
    .map((row) => {
      const hostId = row.paneKey.slice(0, row.paneKey.length - row.rawPaneKey.length - 1)
      const address = row.address ?? null
      const chatSessionId = structuredSessionId(row.rawPaneKey)
      const stamp = lastActive(row)
      refreshCarHistory(hosts, row.paneKey, stamp)
      sessions.set(row.paneKey, {
        hostId,
        address,
        chatSessionId,
        project: row.project,
        title: row.title ?? 'Agent'
      })
      return {
        paneKey: row.paneKey,
        hostId,
        project: row.project ?? 'Orca',
        title: row.title ?? 'Agent',
        state: mainAgentState(row),
        snippet: snippet(messages.sync(row)),
        canReply:
          chatSessionId !== null || (address !== null && parseOrcaSessionAddress(address) === null)
      }
    })
  const activity = rows
    .filter((row) => !row.parentPaneKey)
    .map((row) => ({
      hostId: row.paneKey.slice(0, row.paneKey.length - row.rawPaneKey.length - 1),
      project: row.project ?? 'Orca',
      lastActive: lastActive(row),
      worktreeId: row.worktreeId
    }))
  const projects = carProjects(
    hosts.map(({ hostId }) => hostId),
    latestHostWorktrees,
    activity
  )
  for (const project of projects) {
    if (project.worktreeId) {
      projectWorktrees.set(projectKey(project.hostId, project.name), project.worktreeId)
    }
  }
  const data = {
    projects: projects.map(({ hostId, name, lastActive }) => ({ hostId, name, lastActive })),
    hosts: hosts.map(({ hostId, client }) => ({
      id: hostId,
      name: hostNames.get(hostId) ?? 'Orca',
      connected: client.getState() === 'connected'
    })),
    sessions: sessionRows,
    recent: messages.recent().map((message) => ({
      id: message.id,
      paneKey: message.paneKey,
      project: sessions.get(message.paneKey)?.project ?? 'Orca',
      at: message.at,
      snippet: snippet(message.markdown) ?? ''
    })),
    live
  }
  try {
    native.setCarData(JSON.stringify(data))
  } catch (error) {
    logSpeechEvent(`car data failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// The media list has no toast, so the reader says what Read new did.
function liveWords(paneKey: string | null): string {
  const polish = readerLanguage() === 'pl'
  if (!paneKey) {
    return polish ? 'Czytanie na bieżąco wyłączone.' : 'Reading as it comes is off.'
  }
  const title = sessions.get(paneKey)?.title ?? 'Agent'
  return polish ? `Czytam na bieżąco: ${title}.` : `Reading as it comes: ${title}.`
}

function subscribeCarSession(listener: () => void): () => void {
  carSessionListeners.add(listener)
  return () => carSessionListeners.delete(listener)
}

/** Answers Orca's car screens; true while one is open, which keeps auto-read's checks running. */
export function useCarControls(autoRead: boolean): boolean {
  const rpc = useRpcClientContext()
  useEffect(() => {
    autoReadOn = autoRead
  }, [autoRead])
  useEffect(() => {
    const native = voiceNativeModule()
    if (!native) {
      return
    }
    const setSession = (active: boolean) => {
      if (carSession === active) {
        return
      }
      carSession = active
      live = active ? live : null
      setCarSessionActive(active)
      logSpeechEvent(active ? 'car screen opened' : 'car screen closed')
      carSessionListeners.forEach((listener) => listener())
    }
    setSession(native.isCarSessionActive())
    const subscriptions = [
      native.addListener('onCarSession', ({ active }) => setSession(active)),
      native.addListener('onCarRead', ({ paneKey, messageId }) => {
        void readForCar(rpc.getAllClients(), paneKey, messageId)
      }),
      native.addListener('onCarHistory', ({ paneKey }) => {
        void loadCarHistory(rpc.getAllClients(), paneKey)
      }),
      native.addListener('onCarNewSession', (request) => {
        const worktreeId = projectWorktrees.get(projectKey(request.hostId, request.project))
        void newSessionFromCar(rpc.getAllClients(), request, worktreeId)
      }),
      native.addListener('onCarLive', ({ paneKey, announce }) => {
        live = paneKey
        logSpeechEvent(paneKey ? `car follows live: ${paneKey}` : 'car stopped following live')
        publishCarData(lastRows, lastHosts)
        if (announce) {
          speakReply(`car-live@${Date.now()}`, liveWords(paneKey), 'interrupt')
        }
      }),
      native.addListener('onCarReply', ({ requestId, paneKey, text }) => {
        void replyFromCar(rpc.getAllClients(), requestId, paneKey, text)
      })
    ]
    return () => subscriptions.forEach((subscription) => subscription.remove())
  }, [rpc])
  return useSyncExternalStore(subscribeCarSession, () => carSession)
}
