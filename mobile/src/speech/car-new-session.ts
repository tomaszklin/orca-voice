import { createMobileStructuredAgentSession } from '../session/native-chat/agent-session/mobile-structured-agent-session-launch'
import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { carSessions, clientOf, type HostClient } from './car-sessions'
import { readerLanguage } from './reader-words'
import { speakReply } from './reply-speaker'
import { logSpeechEvent } from './speech-diagnostics'
import { voiceNativeModule } from './voice-native-module'

// Orca Voice fork: a new Claude chat started from the car (owner, 2026-11-26).

type Words = { title: string; created: string; offline: string; failed: string }

const WORDS: Record<'pl' | 'en', Words> = {
  pl: {
    title: 'Nowa sesja',
    created: 'Utworzono nową sesję. Powiedz pierwszą wiadomość.',
    offline: 'Komputer nie jest połączony.',
    failed: 'Nie udało się utworzyć sesji.'
  },
  en: {
    title: 'New session',
    created: 'New session created. Say the first message.',
    offline: 'The computer is not connected.',
    failed: 'Could not create the session.'
  }
}

const words = (): Words => WORDS[readerLanguage() === 'pl' ? 'pl' : 'en']

export type CarNewSession =
  | { sessionId: string; title: string; spoken: string }
  | { error: string; spoken: string }

export async function createCarSession(
  client: RpcClient | undefined,
  worktreeId: string | undefined
): Promise<CarNewSession> {
  const said = words()
  if (!client || !worktreeId) {
    return { error: said.offline, spoken: said.offline }
  }
  const result = await createMobileStructuredAgentSession(client, worktreeId, 'claude').catch(
    () => null
  )
  if (result?.kind === 'created') {
    return { sessionId: result.sessionId, title: said.title, spoken: said.created }
  }
  const reason = result && 'message' in result && result.message ? result.message : said.failed
  return { error: reason, spoken: reason }
}

export type CarNewSessionRequest = {
  requestId: string
  hostId: string
  project: string
  /** The media list has no toast, so the reader says how it went. */
  announce?: boolean
}

/** A new Claude chat in a project's worktree; the car then answers it by voice like any other. */
export async function newSessionFromCar(
  hosts: readonly HostClient[],
  request: CarNewSessionRequest,
  worktreeId: string | undefined
): Promise<void> {
  const native = voiceNativeModule()
  const created = await createCarSession(clientOf(hosts, request.hostId), worktreeId)
  if ('sessionId' in created) {
    const paneKey = `new:${created.sessionId}`
    carSessions.set(paneKey, {
      hostId: request.hostId,
      address: null,
      chatSessionId: created.sessionId,
      project: request.project,
      title: created.title
    })
    native?.carNewSessionResult(request.requestId, true, paneKey)
  } else {
    native?.carNewSessionResult(request.requestId, false, created.error)
  }
  logSpeechEvent(
    `car new session in ${request.project}: ${'error' in created ? created.error : 'created'}`
  )
  if (request.announce) {
    speakReply(`car-new@${Date.now()}`, created.spoken, 'interrupt')
  }
}
