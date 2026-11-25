import { useEffect } from 'react'
import { mainAgentState } from '../../../src/shared/agent-status/lifecycle/main-agent-status'
import { withoutNativeChatVisualDirectiveLines } from '../../../src/shared/native-chat/visuals/native-chat-visual-directive'
import type { AutoReadAgentRow } from './auto-read-agent-rows'
import { speakReply } from './reply-speaker'
import { logSpeechEvent } from './speech-diagnostics'
import { toSpeechText } from './speech-text'
import { voiceNativeModule } from './voice-native-module'

// Orca Voice fork: the agents Android Auto lists (CarMediaBrowser.kt); picking one reads its last message.

const SNIPPET_LENGTH = 200

/** Each pane's newest message: one auto-read handled, or a finished turn not seen before. */
export function createCarAgentMessages() {
  const messages = new Map<string, string>()
  const turns = new Map<string, string>()
  return {
    note(paneKey: string, markdown: string): void {
      messages.set(paneKey, markdown)
    },
    sync(row: AutoReadAgentRow): string | null {
      // Mid-turn the host's last message is tool output; only a finished turn's is a reply.
      if (mainAgentState(row) === 'done' && row.lastAssistantMessage) {
        const turn = `${row.mainAgent?.stateStartedAt ?? row.stateStartedAt}\n${row.lastAssistantMessage}`
        if (turns.get(row.paneKey) !== turn) {
          turns.set(row.paneKey, turn)
          messages.set(row.paneKey, withoutNativeChatVisualDirectiveLines(row.lastAssistantMessage))
        }
      }
      return messages.get(row.paneKey) ?? null
    },
    get(paneKey: string): string | null {
      return messages.get(paneKey) ?? null
    }
  }
}

const carMessages = createCarAgentMessages()
const projects = new Map<string, string | null>()

/** A message of the agent's own that auto-read handled. */
export function noteCarMessage(paneKey: string, markdown: string): void {
  carMessages.note(paneKey, markdown)
}

function snippet(markdown: string | null): string | null {
  const line = markdown
    ? toSpeechText(markdown)
        .split('\n')
        .map((part) => part.trim())
        .find(Boolean)
    : undefined
  return line ? line.slice(0, SNIPPET_LENGTH) : null
}

/** Sends the main agents to the car: working or waiting first, then the most recent. */
export function publishCarAgents(rows: readonly AutoReadAgentRow[]): void {
  const native = voiceNativeModule()
  if (!native) {
    return
  }
  const since = (row: AutoReadAgentRow) => row.mainAgent?.stateStartedAt ?? row.stateStartedAt
  const busy = (row: AutoReadAgentRow) => (mainAgentState(row) === 'done' ? 0 : 1)
  const agents = rows
    .filter((row) => !row.parentPaneKey)
    .sort((a, b) => busy(b) - busy(a) || since(b) - since(a))
    .map((row) => {
      projects.set(row.paneKey, row.project)
      return {
        paneKey: row.paneKey,
        project: row.project ?? 'Orca',
        state: mainAgentState(row),
        snippet: snippet(carMessages.sync(row))
      }
    })
  try {
    native.setCarAgents(JSON.stringify(agents))
  } catch (error) {
    logSpeechEvent(`car list failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Reads the last message of the agent picked in Android Auto. */
export function useCarAgentPicks(): void {
  useEffect(() => {
    const subscription = voiceNativeModule()?.addListener('onCarRead', ({ paneKey }) => {
      const message = carMessages.get(paneKey)
      if (!message) {
        logSpeechEvent(`car pick without a message: ${paneKey}`)
        return
      }
      speakReply(`car:${paneKey}@${Date.now()}`, message, 'interrupt', {
        title: projects.get(paneKey) ?? null
      })
    })
    return () => subscription?.remove()
  }, [])
}
