import { describe, expect, it } from 'vitest'
import type { AutoReadAgentRow } from './auto-read-agent-rows'
import { createCarAgentMessages } from './car-agent-messages'

const pane = 'host:tab:leaf'
const finished = (message: string, endedAt: number): AutoReadAgentRow => ({
  paneKey: pane,
  rawPaneKey: 'tab:leaf',
  parentPaneKey: null,
  worktreeId: 'worktree',
  project: 'project',
  title: 'Claude',
  state: 'done',
  stateStartedAt: endedAt,
  lastAssistantMessage: message,
  toolName: null
})

describe('createCarAgentMessages', () => {
  it('keeps a newer read message over a seen turn, and takes a turn that ended later', () => {
    const messages = createCarAgentMessages()
    expect(messages.sync(finished('first reply', 1))).toBe('first reply')
    messages.note(pane, 'message read during the next turn')
    expect(messages.sync(finished('first reply', 1))).toBe('message read during the next turn')
    expect(messages.sync(finished('reply nobody read', 2))).toBe('reply nobody read')
  })
})
