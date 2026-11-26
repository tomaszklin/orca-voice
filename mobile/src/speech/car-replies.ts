import { parseOrcaSessionAddress } from '../../../src/shared/agent-session/identity/orca-session-address'
import { callAgentSession } from '../session/native-chat/agent-session/mobile-structured-agent-session-rpc'
import { sendMobileStructuredAgentSessionMessage } from '../session/native-chat/agent-session/mobile-structured-agent-session-send'
import { structuredSessionOperationId } from '../session/native-chat/agent-session/structured-session-operation-id'
import { sendMobileNativeChatMessageWithOutcome } from '../session/native-chat/composer/delivery/mobile-native-chat-send'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { carSessions, clientOf, type HostClient } from './car-sessions'
import { readerLanguage } from './reader-words'
import { logSpeechEvent } from './speech-diagnostics'
import { voiceNativeModule } from './voice-native-module'

export type CarReplyOutcome =
  | 'sent'
  | 'unknown'
  | 'refused'
  | 'gone'
  | 'offline'
  | 'old-host'
  | 'chat'
export type CarReplyResult = { outcome: CarReplyOutcome; reason?: string }

/** Where a reply goes: an Orca chat by its session id, or a terminal agent by its handle. */
export type CarReplyTarget = { chatSessionId: string | null; address: string | null }

const FENCE_READ_TIMEOUT_MS = 10_000

/** Sends a reply spoken in the car, once: a delivery that may have landed is reported, never repeated. */
export async function sendCarReply(
  client: RpcClient,
  target: CarReplyTarget,
  text: string
): Promise<CarReplyResult> {
  if (target.chatSessionId) {
    return sendToChat(client, target.chatSessionId, text)
  }
  if (!target.address) {
    return { outcome: 'old-host' }
  }
  if (parseOrcaSessionAddress(target.address)) {
    return { outcome: 'chat' }
  }
  const outcome = await sendMobileNativeChatMessageWithOutcome({
    client,
    terminal: target.address,
    text
  })
  return {
    outcome: outcome === 'accepted' ? 'sent' : outcome === 'unknown' ? 'unknown' : 'refused'
  }
}

// As the chat's composer sends, with the session's current fence read first, since the chat may not
// be open. Without `delivery`, a message during a turn steers it, as typed mid-turn.
async function sendToChat(
  client: RpcClient,
  sessionId: string,
  text: string
): Promise<CarReplyResult> {
  const history = await callAgentSession<{ page?: { fence?: number }; fence?: number }>(
    client,
    'agentSession.history',
    { sessionId, direction: 'tail', limit: 1 },
    FENCE_READ_TIMEOUT_MS
  )
  const fence = history.page?.fence ?? history.fence
  if (typeof fence !== 'number') {
    return { outcome: 'old-host' }
  }
  let reason: string | undefined
  const outcome = await sendMobileStructuredAgentSessionMessage({
    client,
    sessionId,
    expectedRuntimeFence: fence,
    text,
    attachments: [],
    clientMessageId: structuredSessionOperationId(),
    onError: (message) => {
      reason = message
    }
  })
  if (outcome === 'accepted' || outcome === 'queued') {
    return { outcome: 'sent' }
  }
  return { outcome: outcome === 'unknown' ? 'unknown' : 'refused', reason }
}

const WORDS: Record<CarReplyOutcome, [string, string]> = {
  sent: ['Wysłano.', 'Sent.'],
  unknown: [
    'Nie wiem, czy doszło. Sprawdź, zanim wyślesz znowu.',
    'Not sure it arrived. Check before sending again.'
  ],
  refused: ['Komputer nie przyjął odpowiedzi.', 'The computer refused the reply.'],
  gone: ['Tej sesji już nie ma.', 'This session is gone.'],
  offline: ['Komputer nie jest połączony.', 'The computer is not connected.'],
  'old-host': ['Zaktualizuj Orkę na komputerze.', 'Update Orca on the computer.'],
  chat: [
    'Ta sesja nie przyjmuje odpowiedzi z auta.',
    "This session can't take replies from the car."
  ]
}

export function carReplyWords({ outcome, reason }: CarReplyResult): string {
  const [polish, english] = WORDS[outcome]
  const words = readerLanguage() === 'pl' ? polish : english
  return reason ? `${words} ${reason}` : words
}

/** A reply spoken in the car, sent to its session; the car hears how it went. */
export async function replyFromCar(
  hosts: readonly HostClient[],
  requestId: string,
  paneKey: string,
  text: string
): Promise<void> {
  const target = carSessions.get(paneKey)
  const client = target ? clientOf(hosts, target.hostId) : undefined
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
