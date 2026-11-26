import { mainAgentState } from '../../../src/shared/agent-status/lifecycle/main-agent-status'
import { withoutNativeChatVisualDirectiveLines } from '../../../src/shared/native-chat/visuals/native-chat-visual-directive'
import type { AutoReadAgentRow } from './auto-read-agent-rows'

const RECENT_LIMIT = 20

export type CarRecentMessage = { id: string; paneKey: string; at: number; markdown: string }

/** Each pane's newest message (one auto-read handled, or a finished turn not seen before), and the latest few. */
export function createCarAgentMessages() {
  const messages = new Map<string, string>()
  const turns = new Map<string, string>()
  const recent: CarRecentMessage[] = []
  let nextId = 0
  return {
    note(paneKey: string, markdown: string): void {
      messages.set(paneKey, markdown)
      if (recent[0]?.paneKey === paneKey && recent[0].markdown === markdown) {
        return
      }
      recent.unshift({ id: `message-${nextId++}`, paneKey, at: Date.now(), markdown })
      recent.splice(RECENT_LIMIT)
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
    },
    recent(): readonly CarRecentMessage[] {
      return recent
    }
  }
}
