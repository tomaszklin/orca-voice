import { beforeEach, describe, expect, it, vi } from 'vitest'

const tabsReply: { current: { tabs: unknown[] } } = { current: { tabs: [] } }
const transcripts = new Map<string, unknown[]>()

vi.mock('../session/mobile-session-read-operations', () => ({
  sessionTabsListRead: {
    request: async () => ({ ok: true }),
    interpret: () => tabsReply.current
  },
  nativeChatSessionPageRead: {
    request: async (_client: unknown, params: { sessionId: string }) => params.sessionId,
    interpret: (sessionId: string) => {
      const messages = transcripts.get(sessionId)
      return messages ? { accepted: true, value: { messages } } : { accepted: false }
    }
  }
}))

const { createNestedSessionGuard, endsMidTurn, hasSeveralTurns } =
  await import('./nested-session-guard')

const leafId = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const paneKey = 'host:tab-1:' + leafId
const client = {} as never
const reply = { paneKey, message: 'Answer', endedAt: 1 }

function row(state: 'working' | 'done') {
  return {
    paneKey,
    rawPaneKey: 'tab-1:' + leafId,
    worktreeId: 'wt',
    parentPaneKey: null,
    state,
    stateStartedAt: 0,
    lastAssistantMessage: null,
    toolName: null,
    project: null
  }
}

function paneIn(session: string, state: 'working' | 'done' = 'done') {
  tabsReply.current = {
    tabs: [
      {
        type: 'terminal',
        id: 'tab-1',
        leafId,
        agentStatus: {
          agentType: 'claude',
          state,
          providerSession: { id: session, transcriptPath: `/t/${session}.jsonl` }
        }
      }
    ]
  }
}

const user = { role: 'user', blocks: [{ type: 'text' }] }
const prose = { role: 'assistant', blocks: [{ type: 'text' }] }
const toolCall = { role: 'assistant', blocks: [{ type: 'tool-call' }] }
const toolResult = { role: 'tool', blocks: [{ type: 'tool-result' }] }
const thinking = { role: 'reasoning', blocks: [{ type: 'text' }] }
const status = { role: 'system', blocks: [{ type: 'text' }] }

describe('endsMidTurn', () => {
  it('sees a tool call or its result at the end of a transcript', () => {
    expect(endsMidTurn([user, toolCall])).toBe(true)
    expect(endsMidTurn([user, toolCall, toolResult])).toBe(true)
    expect(endsMidTurn([user, toolCall, thinking])).toBe(true)
  })

  it('takes prose, a prompt or a cancelled turn as no turn in progress', () => {
    expect(endsMidTurn([user, toolCall, toolResult, prose])).toBe(false)
    expect(endsMidTurn([user, prose, status])).toBe(false)
    expect(endsMidTurn([prose, user])).toBe(false)
    expect(endsMidTurn([])).toBe(false)
  })
})

describe('hasSeveralTurns', () => {
  it('counts prompts, not tool results', () => {
    expect(hasSeveralTurns([user, toolCall, toolResult, prose])).toBe(false)
    expect(hasSeveralTurns([user, prose, user, prose])).toBe(true)
  })
})

describe('createNestedSessionGuard', () => {
  beforeEach(() => {
    transcripts.clear()
  })

  const ownReplies = (
    guard: ReturnType<typeof createNestedSessionGuard>,
    state: 'working' | 'done' = 'done'
  ) => guard.ownReplies(client, [row(state)], [reply])

  /** The pane's session learned from a first reply, then its agent starts a tool call. */
  async function guardOfAgentInToolCall() {
    const guard = createNestedSessionGuard()
    paneIn('home')
    await ownReplies(guard)
    transcripts.set('home', [user, toolCall])
    return guard
  }

  it('drops the reply of a run the pane’s agent started', async () => {
    const guard = await guardOfAgentInToolCall()
    paneIn('nested')
    transcripts.set('nested', [user, prose])
    expect(await ownReplies(guard)).toEqual([])
  })

  it('drops a nested reply whose run keeps no transcript', async () => {
    const guard = await guardOfAgentInToolCall()
    paneIn('nested')
    expect(await ownReplies(guard)).toEqual([])
  })

  it('still reads the agent’s own reply after a nested run', async () => {
    const guard = await guardOfAgentInToolCall()
    paneIn('nested')
    await ownReplies(guard)
    transcripts.set('home', [user, toolCall, toolResult, prose])
    paneIn('home')
    expect(await ownReplies(guard)).toEqual([reply])
  })

  it('drops a nested reply when the pane has already gone back to its agent', async () => {
    const guard = await guardOfAgentInToolCall()
    transcripts.set('home', [user, toolCall, toolResult])
    paneIn('home', 'working')
    expect(await ownReplies(guard, 'done')).toEqual([])
  })

  it('reads a reply whose next turn has already begun', async () => {
    const guard = await guardOfAgentInToolCall()
    transcripts.set('home', [user, toolCall, toolResult, prose, user])
    paneIn('home', 'working')
    expect(await ownReplies(guard)).toEqual([reply])
  })

  it('learns the pane’s session during the first turn, before any reply', async () => {
    const guard = createNestedSessionGuard()
    paneIn('home', 'working')
    await guard.ownReplies(client, [row('working')], [])
    transcripts.set('home', [user, toolCall])
    paneIn('nested')
    expect(await ownReplies(guard)).toEqual([])
  })

  it('follows a session that took over from a finished one', async () => {
    const guard = createNestedSessionGuard()
    paneIn('home')
    await ownReplies(guard)
    transcripts.set('home', [user, prose])
    paneIn('next')
    expect(await ownReplies(guard)).toEqual([reply])
    const next = { agent: 'claude', sessionId: 'next', transcriptPath: null }
    expect(await guard.isNested(client, paneKey, next)).toBe(false)
  })

  it('follows a new session after an agent killed during a tool call', async () => {
    const guard = await guardOfAgentInToolCall()
    paneIn('next')
    transcripts.set('next', [user, prose, user, prose])
    expect(await ownReplies(guard)).toEqual([reply])
  })

  it('reads the reply when the pane’s own transcript cannot be read', async () => {
    const guard = await guardOfAgentInToolCall()
    transcripts.delete('home')
    paneIn('nested')
    expect(await ownReplies(guard)).toEqual([reply])
  })

  it('reads the reply when the pane reports no session', async () => {
    const guard = createNestedSessionGuard()
    tabsReply.current = { tabs: [] }
    expect(await ownReplies(guard)).toEqual([reply])
  })
})
