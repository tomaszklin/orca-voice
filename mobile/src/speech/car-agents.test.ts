import { describe, expect, it, vi } from 'vitest'
import type { AutoReadAgentRow } from './auto-read-agent-rows'
import { createCarAgentMessages } from './car-agents'

vi.mock('./reply-speaker', () => ({ speakReply: vi.fn() }))

const pane = 'host:tab:leaf'
const finished = (message: string, endedAt: number): AutoReadAgentRow => ({
  paneKey: pane,
  rawPaneKey: 'tab:leaf',
  parentPaneKey: null,
  worktreeId: 'worktree',
  project: 'project',
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
