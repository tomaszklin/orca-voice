import { parseOrcaSessionAddress } from '../../../src/shared/agent-session/identity/orca-session-address'
import { sendMobileNativeChatMessageWithOutcome } from '../session/native-chat/composer/delivery/mobile-native-chat-send'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { readerLanguage } from './reader-words'

export type CarReplyOutcome =
  | 'sent'
  | 'unknown'
  | 'refused'
  | 'gone'
  | 'offline'
  | 'old-host'
  | 'chat'

/** Types a reply spoken in the car into the agent's terminal and presses Enter. */
export async function sendCarReply(
  client: RpcClient,
  address: string | null,
  text: string
): Promise<CarReplyOutcome> {
  if (!address) {
    return 'old-host'
  }
  if (parseOrcaSessionAddress(address)) {
    return 'chat'
  }
  // Sent once: a delivery that may have landed is reported, never repeated, so the agent never gets it twice.
  const outcome = await sendMobileNativeChatMessageWithOutcome({ client, terminal: address, text })
  return outcome === 'accepted' ? 'sent' : outcome === 'unknown' ? 'unknown' : 'refused'
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
    'Odpowiedzi z auta działają na razie tylko w sesjach terminala.',
    'Car replies work only in terminal sessions for now.'
  ]
}

export function carReplyWords(outcome: CarReplyOutcome): string {
  const [polish, english] = WORDS[outcome]
  return readerLanguage() === 'pl' ? polish : english
}
