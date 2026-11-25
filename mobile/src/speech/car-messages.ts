import { useEffect, useSyncExternalStore } from 'react'
import * as z from 'zod'
import { mainAgentState } from '../../../src/shared/agent-status/lifecycle/main-agent-status'
import { parsePaneKey } from '../../../src/shared/workspace-layout/stable-pane-id'
import { sendMobileNativeChatMessage } from '../session/native-chat/composer/delivery/mobile-native-chat-send'
import { terminalInputSend } from '../terminal/host-operations/mobile-terminal-operations'
import {
  buildTerminalSendParams,
  TERMINAL_INPUT_SEND_OPTIONS
} from '../terminal/input-delivery/terminal-send-request'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../transport/rpc/rpc-operation-result-reader'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { useRpcClientContext } from '../transport/connection/client-context'
import type { AutoReadAgentRow } from './auto-read-agent-rows'
import { readerLanguage } from './reader-words'
import { speakReply } from './reply-speaker'
import { logSpeechEvent } from './speech-diagnostics'
import { toSpeechText } from './speech-text'
import { createStoredChoice } from './stored-choice'
import { voiceNativeModule } from './voice-native-module'

/**
 * Orca Voice fork: Orca in Android Auto.
 *
 * Orca's own car screen (`OrcaCarApp.kt`) lists the agents auto-read follows, with each one's last
 * message; Read speaks it with Orca's reader, Reply sends what the car's microphone heard to the
 * agent's terminal. Messages keep being read by Orca's reader, in the voice set on the phone.
 *
 * Optionally (off by default) messages go to Android Auto as chat notifications instead: the car
 * reads them in its own voice and takes a reply through the Assistant.
 */

export const useCarNotifications = createStoredChoice<'on' | 'off'>(
  'orca:voiceCarNotifications',
  ['on', 'off'],
  'off'
)

let carNotificationsOn = false
let carConnected = false
const connectionListeners = new Set<() => void>()

/** Where a pane's replies go back to. */
type CarPane = {
  hostId: string
  rawPaneKey: string
  worktreeId: string
  project: string | null
}
const panes = new Map<string, CarPane>()
/** The last message auto-read handled per pane, as markdown. */
const lastMessages = new Map<string, string>()

const polish = () => readerLanguage() === 'pl'

type CarAgent = { paneKey: string; project: string; state: string; message: string | null }

/** Keeps the panes auto-read last saw, and shows them on the car's screen. */
export function rememberCarPanes(rows: readonly AutoReadAgentRow[]): void {
  const shown: (CarAgent & { order: number })[] = []
  for (const row of rows) {
    if (!row.worktreeId || row.parentPaneKey) {
      continue
    }
    const hostId = row.paneKey.slice(0, row.paneKey.length - row.rawPaneKey.length - 1)
    panes.set(row.paneKey, {
      hostId,
      rawPaneKey: row.rawPaneKey,
      worktreeId: row.worktreeId,
      project: row.project
    })
    const state = mainAgentState(row)
    // Mid-turn, the host's last message is tool output; only a finished turn's is a reply.
    const message =
      lastMessages.get(row.paneKey) ??
      (state === 'done' && row.lastAssistantMessage ? row.lastAssistantMessage : null)
    const since = row.mainAgent?.stateStartedAt ?? row.stateStartedAt
    shown.push({
      paneKey: row.paneKey,
      project: row.project ?? 'Orca',
      state,
      message: message ? toSpeechText(message).trim() : null,
      // Agents at work or waiting first, then the most recent.
      order: (state === 'done' ? 0 : 1e15) + since
    })
  }
  shown.sort((a, b) => b.order - a.order)
  const agents: CarAgent[] = shown.map(({ order: _order, ...agent }) => agent)
  try {
    voiceNativeModule()?.setCarAgents(JSON.stringify(agents))
  } catch (error) {
    logSpeechEvent(`car list failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Every message auto-read handles comes here first: kept for the car screen's Read, and sent as
 * an Android Auto notification when those are on. False when the phone's reader should read it.
 */
export function sendToCar(paneKey: string, project: string | null, markdown: string): boolean {
  lastMessages.set(paneKey, markdown)
  const native = voiceNativeModule()
  if (!native || !carNotificationsOn || !carConnected) {
    return false
  }
  const text = toSpeechText(markdown).trim()
  if (!text) {
    return true
  }
  const posted = native.postCarMessage(paneKey, project ?? 'Orca', text)
  logSpeechEvent(posted ? `sent to the car: ${paneKey}` : `car message failed: ${paneKey}`)
  return posted
}

function subscribeConnection(listener: () => void): () => void {
  connectionListeners.add(listener)
  return () => connectionListeners.delete(listener)
}

export function useCarConnected(): boolean {
  return useSyncExternalStore(subscribeConnection, () => carConnected)
}

const terminalList = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'terminal.voice-car-reply-pane',
    method: 'terminal.list',
    acceptance: 'require-result-or-throw',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant(
      'car-reply-pane-inventory',
      z.looseObject({
        terminals: z.array(
          z.looseObject({
            handle: z.string(),
            tabId: z.string().nullish(),
            leafId: z.string().nullish()
          })
        )
      })
    )
  })
)

async function terminalForPane(client: RpcClient, pane: CarPane): Promise<string | null> {
  const parsed = parsePaneKey(pane.rawPaneKey)
  if (!parsed) {
    return null
  }
  const reply = terminalList.interpret(
    await terminalList.request(client, { worktree: `id:${pane.worktreeId}` })
  )
  // The leaf id names the pane; the tab id picks among equal leaves when the host reports it.
  const leaves = reply.terminals.filter((entry) => entry.leafId === parsed.leafId)
  const terminal = leaves.find((entry) => entry.tabId === parsed.tabId) ?? leaves[0]
  return terminal ? terminal.handle : null
}

type Delivery = { ok: true } | { ok: false; why: string }

/** Types a reply into its agent and presses Enter. */
async function deliverReply(
  clients: readonly { hostId: string; client: RpcClient }[],
  paneKey: string,
  text: string
): Promise<Delivery> {
  const pane = panes.get(paneKey)
  if (!pane) {
    return { ok: false, why: 'unknown agent' }
  }
  const client = clients.find(({ hostId }) => hostId === pane.hostId)?.client
  if (!client) {
    return { ok: false, why: 'computer not connected' }
  }
  try {
    const terminal = await terminalForPane(client, pane)
    if (!terminal) {
      return { ok: false, why: 'agent terminal not found' }
    }
    if (await sendMobileNativeChatMessage({ client, terminal, text })) {
      return { ok: true }
    }
    // The plain terminal input, as dictation into an off-screen terminal uses.
    const reply = await terminalInputSend.request(
      client,
      buildTerminalSendParams({ terminal, text, enter: true, deviceToken: null }),
      TERMINAL_INPUT_SEND_OPTIONS
    )
    return terminalInputSend.interpret(reply) === true
      ? { ok: true }
      : { ok: false, why: 'the computer refused it' }
  } catch (error) {
    return { ok: false, why: error instanceof Error ? error.message : String(error) }
  }
}

async function deliverAndLog(
  clients: readonly { hostId: string; client: RpcClient }[],
  paneKey: string,
  text: string
): Promise<Delivery> {
  const result = await deliverReply(clients, paneKey, text)
  logSpeechEvent(
    result.ok ? `car reply sent: ${paneKey}` : `car reply not sent (${result.why}): ${paneKey}`
  )
  return result
}

function readLast(paneKey: string): void {
  const message = lastMessages.get(paneKey)
  if (message) {
    speakReply(`car:${paneKey}@${Date.now()}`, message, 'interrupt', {
      title: panes.get(paneKey)?.project ?? null
    })
  }
}

function resultText(result: Delivery): string {
  if (result.ok) {
    return polish() ? 'Wysłano.' : 'Sent.'
  }
  return polish() ? `Nie wysłano: ${result.why}.` : `Not sent: ${result.why}.`
}

/** Follows the car connection and the settings, and answers the car's buttons and replies. */
export function useCarMessaging(): void {
  const rpc = useRpcClientContext()
  const { value } = useCarNotifications()

  useEffect(() => {
    carNotificationsOn = value === 'on'
    if (!carNotificationsOn) {
      voiceNativeModule()?.clearCarMessages()
    }
  }, [value])

  useEffect(() => {
    const native = voiceNativeModule()
    if (!native) {
      return
    }
    const setConnected = (connected: boolean) => {
      if (connected !== carConnected) {
        carConnected = connected
        logSpeechEvent(connected ? 'car connected' : 'car disconnected')
        connectionListeners.forEach((listener) => listener())
      }
    }
    setConnected(native.isCarConnected())
    const connection = native.addListener('onCarConnection', ({ connected }) =>
      setConnected(connected)
    )
    // A reply through Android Auto's own messaging (notifications on).
    const replies = native.addListener('onCarReply', ({ conversation, text }) => {
      void deliverAndLog(rpc.getAllClients(), conversation, text).then((result) => {
        if (!result.ok) {
          native.postCarMessage(conversation, 'Orca', resultText(result))
        }
      })
    })
    // Orca's own car screen.
    const actions = native.addListener('onCarAction', ({ action, paneKey, text }) => {
      if (action === 'read') {
        readLast(paneKey)
      } else if (action === 'reply' && text) {
        void deliverAndLog(rpc.getAllClients(), paneKey, text).then((result) =>
          native.carReplyResult(result.ok, resultText(result))
        )
      }
    })
    return () => {
      connection.remove()
      replies.remove()
      actions.remove()
    }
  }, [rpc])
}
