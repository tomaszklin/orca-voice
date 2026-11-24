import { useEffect, useSyncExternalStore } from 'react'
import * as z from 'zod'
import { parsePaneKey } from '../../../src/shared/workspace-layout/stable-pane-id'
import { sendMobileNativeChatMessage } from '../session/native-chat/composer/delivery/mobile-native-chat-send'
import { bindDeferredRpcOperation, defineRpcOperation } from '../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../transport/rpc/rpc-operation-result-reader'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { useRpcClientContext } from '../transport/connection/client-context'
import { logSpeechEvent } from './speech-diagnostics'
import { toSpeechText } from './speech-text'
import { createStoredChoice } from './stored-choice'
import { voiceNativeModule } from './voice-native-module'

/**
 * Orca Voice fork: in a car with Android Auto, auto-read hands each message to the car as a chat
 * message instead of speaking it. The car reads it, and a spoken reply comes back here and is
 * typed into that agent's terminal. One conversation per agent pane.
 */

export const useCarMessages = createStoredChoice<'on' | 'off'>(
  'orca:voiceCarMessages',
  ['on', 'off'],
  'on'
)

let carMessagesOn = true
let carConnected = false
const connectionListeners = new Set<() => void>()

/** Where a pane's replies go back to. */
type CarPane = { hostId: string; rawPaneKey: string; worktreeId: string }
const panes = new Map<string, CarPane>()

/** Keeps the panes auto-read last saw, so a reply from the car can find its agent. */
export function rememberCarPanes(
  rows: readonly {
    paneKey: string
    rawPaneKey: string
    worktreeId: string | null
  }[]
): void {
  for (const row of rows) {
    if (!row.worktreeId) {
      continue
    }
    const hostId = row.paneKey.slice(0, row.paneKey.length - row.rawPaneKey.length - 1)
    panes.set(row.paneKey, {
      hostId,
      rawPaneKey: row.rawPaneKey,
      worktreeId: row.worktreeId
    })
  }
}

/** Whether messages go to the car now rather than to the phone's own reader. */
export function carMessagesActive(): boolean {
  return carMessagesOn && carConnected && voiceNativeModule() !== null
}

/** Sends one message to the car; false when it should be read on the phone instead. */
export function sendToCar(paneKey: string, project: string | null, markdown: string): boolean {
  const native = voiceNativeModule()
  if (!native || !carMessagesActive()) {
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
      z.object({
        terminals: z.array(
          z.looseObject({
            handle: z.string(),
            tabId: z.string(),
            leafId: z.string(),
            writable: z.boolean().optional()
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
    await terminalList.request(client, {
      worktree: `id:${pane.worktreeId}`,
      includeVisualLayouts: false,
      includePreview: false
    })
  )
  const terminal = reply.terminals.find(
    (entry) => entry.tabId === parsed.tabId && entry.leafId === parsed.leafId
  )
  return terminal && terminal.writable !== false ? terminal.handle : null
}

/** Types a reply spoken in the car into its agent; tells the car when that failed. */
async function deliverCarReply(
  clients: readonly { hostId: string; client: RpcClient }[],
  paneKey: string,
  text: string
): Promise<void> {
  const native = voiceNativeModule()
  const fail = (why: string) => {
    logSpeechEvent(`car reply not sent (${why}): ${paneKey}`)
    native?.postCarMessage(paneKey, 'Orca', 'Your reply was not sent.')
  }
  const pane = panes.get(paneKey)
  if (!pane) {
    return fail('unknown agent')
  }
  const client = clients.find(({ hostId }) => hostId === pane.hostId)?.client
  if (!client) {
    return fail('computer not connected')
  }
  try {
    const terminal = await terminalForPane(client, pane)
    if (!terminal) {
      return fail('terminal gone')
    }
    const sent = await sendMobileNativeChatMessage({ client, terminal, text })
    if (!sent) {
      return fail('send refused')
    }
    logSpeechEvent(`car reply sent: ${paneKey}`)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

/** Follows the car connection and the setting, and sends the car's replies to their agents. */
export function useCarMessaging(): void {
  const rpc = useRpcClientContext()
  const { value } = useCarMessages()

  useEffect(() => {
    carMessagesOn = value === 'on'
    if (!carMessagesOn) {
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
    const replies = native.addListener('onCarReply', ({ conversation, text }) => {
      void deliverCarReply(rpc.getAllClients(), conversation, text)
    })
    return () => {
      connection.remove()
      replies.remove()
    }
  }, [rpc])
}
