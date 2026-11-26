import { useEffect, useSyncExternalStore } from 'react'
import { mainAgentState } from '../../../src/shared/agent-status/lifecycle/main-agent-status'
import { parseOrcaSessionAddress } from '../../../src/shared/agent-session/identity/orca-session-address'
import { loadStoredHostProfiles } from '../host-catalog/host-metadata-store'
import { useRpcClientContext } from '../transport/connection/client-context'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import type { AutoReadAgentRow } from './auto-read-agent-rows'
import { setCarSessionActive } from './background-reading-state'
import { createCarAgentMessages } from './car-agent-messages'
import { carReplyWords, sendCarReply, type CarReplyResult } from './car-replies'
import { readerLanguage } from './reader-words'
import { speakReply } from './reply-speaker'
import { structuredSessionId } from './structured-reply-text'
import { logSpeechEvent } from './speech-diagnostics'
import { toSpeechText } from './speech-text'
import { voiceNativeModule } from './voice-native-module'

// Orca Voice fork: what Orca's Android Auto screens show (OrcaCarApp.kt, CarMediaBrowser.kt), and their requests.

type HostClient = { hostId: string; client: RpcClient }
type CarSession = {
  hostId: string
  address: string | null
  /** An Orca chat's session id; replies go there rather than to a terminal. */
  chatSessionId: string | null
  project: string | null
  title: string
}

const SNIPPET_LENGTH = 400
const HOST_NAMES_EVERY_MS = 60_000

const messages = createCarAgentMessages()
const sessions = new Map<string, CarSession>()
let hostNames = new Map<string, string>()
let hostNamesAt = 0
let lastRows: readonly AutoReadAgentRow[] = []
let lastHosts: readonly HostClient[] = []
// The session the car follows live: its messages are read, and only its.
let live: string | null = null
let autoReadOn = false
let carSession = false
const carSessionListeners = new Set<() => void>()

/** Notes an agent's message for the car; false when the car's choices keep it from being read. */
export function carLetsRead(paneKey: string, markdown: string, agentMessage: boolean): boolean {
  if (agentMessage) {
    messages.note(paneKey, markdown)
  }
  return live === null ? autoReadOn : paneKey === live
}

function snippet(markdown: string | null): string | null {
  const text = markdown ? toSpeechText(markdown).trim() : ''
  return text ? text.slice(0, SNIPPET_LENGTH) : null
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

/** Sends the car its computers, sessions (working or waiting first) and latest messages. */
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
  const since = (row: AutoReadAgentRow) => row.mainAgent?.stateStartedAt ?? row.stateStartedAt
  const busy = (row: AutoReadAgentRow) => (mainAgentState(row) === 'done' ? 0 : 1)
  const sessionRows = rows
    .filter((row) => !row.parentPaneKey)
    .sort((a, b) => busy(b) - busy(a) || since(b) - since(a))
    .map((row) => {
      const hostId = row.paneKey.slice(0, row.paneKey.length - row.rawPaneKey.length - 1)
      const address = row.address ?? null
      const chatSessionId = structuredSessionId(row.rawPaneKey)
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
  const data = {
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

function readForCar(paneKey: string | null, recentId: string | null): void {
  const recent = recentId ? messages.recent().find((message) => message.id === recentId) : undefined
  const pane = recent?.paneKey ?? paneKey
  const message = recent?.markdown ?? (pane ? messages.get(pane) : null)
  if (!pane || !message) {
    logSpeechEvent(`car read without a message: ${pane ?? recentId}`)
    return
  }
  speakReply(`car:${recentId ?? pane}@${Date.now()}`, message, 'interrupt', {
    title: sessions.get(pane)?.project ?? null
  })
}

async function replyFromCar(
  hosts: readonly HostClient[],
  requestId: string,
  paneKey: string,
  text: string
): Promise<void> {
  const target = sessions.get(paneKey)
  const client = target ? hosts.find(({ hostId }) => hostId === target.hostId)?.client : undefined
  let result: CarReplyResult = { outcome: 'gone' }
  if (target && !client) {
    result = { outcome: 'offline' }
  } else if (target && client) {
    result = await sendCarReply(client, target, text).catch((error: unknown): CarReplyResult => ({
      outcome: 'unknown',
      reason: error instanceof Error ? error.message : undefined
    }))
  }
  logSpeechEvent(
    `car reply ${result.outcome}${result.reason ? ` (${result.reason})` : ''}: ${paneKey}`
  )
  voiceNativeModule()?.carReplyResult(requestId, result.outcome === 'sent', carReplyWords(result))
}

// The media list has no toast, so the reader says what Live did.
function liveWords(paneKey: string | null): string {
  const polish = readerLanguage() === 'pl'
  if (!paneKey) {
    return polish ? 'Na żywo wyłączone.' : 'Live off.'
  }
  const title = sessions.get(paneKey)?.title ?? 'Agent'
  return polish ? `Na żywo: ${title}.` : `Live: ${title}.`
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
      native.addListener('onCarRead', ({ paneKey, recentId }) => readForCar(paneKey, recentId)),
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
