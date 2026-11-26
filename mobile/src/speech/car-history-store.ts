import { readCarHistory, wholeCarMessage, type CarHistoryMessage } from './car-history'
import { carMessages, carSessions, carSnippet, clientOf, type HostClient } from './car-sessions'
import { speakReply } from './reply-speaker'
import { logSpeechEvent } from './speech-diagnostics'
import { voiceNativeModule } from './voice-native-module'

// Orca Voice fork: the session histories the car asked for, and reading one message aloud.

const histories = new Map<string, readonly CarHistoryMessage[]>()
// The activity each history was last read at, so a busier session is read again.
const stamps = new Map<string, number>()
const loading = new Set<string>()

// Without a chat to read, the messages auto-read noted for the pane stand in.
function notedHistory(paneKey: string): CarHistoryMessage[] {
  return carMessages
    .recent()
    .filter((message) => message.paneKey === paneKey)
    .map(({ id, at, markdown }) => ({ id, fromUser: false, at, markdown, shortened: false }))
}

export async function loadCarHistory(hosts: readonly HostClient[], paneKey: string): Promise<void> {
  const target = carSessions.get(paneKey)
  const native = voiceNativeModule()
  if (!target || !native || loading.has(paneKey)) {
    return
  }
  loading.add(paneKey)
  const client = clientOf(hosts, target.hostId)
  let list = notedHistory(paneKey)
  try {
    if (target.chatSessionId && client) {
      list = await readCarHistory(client, target.chatSessionId)
    }
  } catch (error) {
    logSpeechEvent(`car history failed: ${error instanceof Error ? error.message : String(error)}`)
    list = histories.get(paneKey)?.slice() ?? list
  } finally {
    loading.delete(paneKey)
  }
  histories.set(paneKey, list)
  const shown = list.map(({ id, fromUser, at, markdown }) => ({
    id,
    fromUser,
    at,
    snippet: carSnippet(markdown) ?? ''
  }))
  native.setCarHistory(paneKey, JSON.stringify(shown))
}

/** Reads a shown history again when its session's activity changed. */
export function refreshCarHistory(
  hosts: readonly HostClient[],
  paneKey: string,
  activity: number
): void {
  if (histories.has(paneKey) && stamps.get(paneKey) !== activity) {
    stamps.set(paneKey, activity)
    void loadCarHistory(hosts, paneKey)
  }
}

/** A session's last message, or one message of its history or of the recent list. */
export async function readForCar(
  hosts: readonly HostClient[],
  paneKey: string | null,
  messageId: string | null
): Promise<void> {
  const inHistory =
    paneKey && messageId ? histories.get(paneKey)?.find(({ id }) => id === messageId) : undefined
  const recent =
    !inHistory && messageId ? carMessages.recent().find(({ id }) => id === messageId) : undefined
  const pane = recent?.paneKey ?? paneKey
  let message = inHistory?.markdown ?? recent?.markdown ?? (pane ? carMessages.get(pane) : null)
  const target = pane ? carSessions.get(pane) : undefined
  const client = target ? clientOf(hosts, target.hostId) : undefined
  if (inHistory?.shortened && target?.chatSessionId && client) {
    message = await wholeCarMessage(client, target.chatSessionId, inHistory).catch(() => message)
  }
  if (!pane || !message) {
    logSpeechEvent(`car read without a message: ${pane ?? messageId}`)
    return
  }
  speakReply(`car:${messageId ?? pane}@${Date.now()}`, message, 'interrupt', {
    title: target?.project ?? null
  })
}
