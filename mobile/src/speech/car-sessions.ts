import type { RpcClient } from '../transport/rpc/rpc-client-contract'
import { createCarAgentMessages } from './car-agent-messages'
import { toSpeechText } from './speech-text'

// Orca Voice fork: what the car's screens and their requests share (`car-agents.ts`).

export type HostClient = { hostId: string; client: RpcClient }

export type CarSession = {
  hostId: string
  address: string | null
  /** An Orca chat's session id; replies go there rather than to a terminal. */
  chatSessionId: string | null
  project: string | null
  title: string
}

/** The sessions the car lists, by pane key, and the chats it started (`new:<session id>`). */
export const carSessions = new Map<string, CarSession>()

/** Each pane's newest message, and the latest few of all, as auto-read handled them. */
export const carMessages = createCarAgentMessages()

const SNIPPET_LENGTH = 400

/** A message as the car shows it: plain speech text, cut short. */
export function carSnippet(markdown: string | null): string | null {
  const text = markdown ? toSpeechText(markdown).trim() : ''
  return text ? text.slice(0, SNIPPET_LENGTH) : null
}

export function clientOf(hosts: readonly HostClient[], hostId: string): RpcClient | undefined {
  return hosts.find((host) => host.hostId === hostId)?.client
}
