import { beforeEach, describe, expect, it, vi } from 'vitest'

const leafId = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const transcript: { current: unknown[] | null } = { current: null }

// Orca moved the tabs read to its own module; both mocks hand out the same object.
vi.mock('../session/tabs/mobile-session-tab-read-operations', async () => ({
  sessionTabsListRead: (
    (await import('../session/native-chat/agent-session/mobile-native-chat-page-read-operations')) as unknown as {
      sessionTabsListRead: unknown
    }
  ).sessionTabsListRead
}))
vi.mock('../session/native-chat/agent-session/mobile-native-chat-page-read-operations', () => ({
  sessionTabsListRead: {
    request: async () => ({ ok: true }),
    interpret: () => ({
      tabs: [
        {
          type: 'terminal',
          id: 'tab-1',
          leafId,
          agentStatus: { agentType: 'claude', providerSession: { id: 'session-1' } }
        }
      ]
    })
  },
  nativeChatSessionPageRead: {
    request: async () => null,
    interpret: () =>
      transcript.current
        ? { accepted: true, value: { messages: transcript.current } }
        : { accepted: false }
  }
}))

vi.mock('./stored-choice', () => ({ createStoredChoice: () => () => ({}) }))

const { createUserTurnGuard, latestPrompt } = await import('./user-turn-guard')

const paneKey = 'host:tab-1:' + leafId
const client = {} as never
const reply = { paneKey, message: 'Answer', endedAt: 1 }
const rows = [
  {
    paneKey,
    rawPaneKey: 'tab-1:' + leafId,
    worktreeId: 'wt',
    parentPaneKey: null,
    state: 'done',
    stateStartedAt: 0,
    lastAssistantMessage: 'Answer',
    toolName: null,
    project: null
  }
]

function user(id: string, text: string) {
  return { id, role: 'user', blocks: [{ type: 'text', text }] }
}
const answer = { id: 'a', role: 'assistant', blocks: [{ type: 'text', text: 'Done' }] }
const notice = user('n1', '<task-notification>\n<task-id>b1</task-id>\n</task-notification>')

describe('latestPrompt', () => {
  it('tells the user’s own message from a harness notice', () => {
    expect(latestPrompt([user('u1', 'Build it'), answer])).toEqual({ id: 'u1', fromUser: true })
    expect(latestPrompt([user('u1', 'Build it'), answer, notice, answer])).toEqual({
      id: 'n1',
      fromUser: false
    })
    expect(latestPrompt([answer])).toBeNull()
  })
})
describe('createUserTurnGuard', () => {
  beforeEach(() => {
    transcript.current = null
  })

  async function read(guard: ReturnType<typeof createUserTurnGuard>) {
    const result = await guard.userReplies(client, rows, [reply])
    result.commit()
    return result.replies
  }

  it('reads the first reply to a prompt and skips a second one with no new prompt', async () => {
    const guard = createUserTurnGuard()
    transcript.current = [user('u1', 'Build it'), answer]
    expect(await read(guard)).toEqual([reply])
    // A message from another session is hidden from the transcript: the same prompt is latest.
    transcript.current = [user('u1', 'Build it'), answer, answer]
    expect(await read(guard)).toEqual([])
    transcript.current = [user('u1', 'Build it'), answer, answer, user('u2', 'Again'), answer]
    expect(await read(guard)).toEqual([reply])
  })

  it('reads a reply again when the poll that found it was dropped', async () => {
    const guard = createUserTurnGuard()
    transcript.current = [user('u1', 'Build it'), answer]
    const dropped = await guard.userReplies(client, rows, [reply])
    expect(dropped.replies).toEqual([reply])
    expect(await read(guard)).toEqual([reply])
  })

  it('skips a reply to a background task notice', async () => {
    transcript.current = [user('u1', 'Build it'), answer, notice, answer]
    expect(await read(createUserTurnGuard())).toEqual([])
  })

  it('reads the reply when the transcript cannot tell', async () => {
    expect(await read(createUserTurnGuard())).toEqual([reply])
    transcript.current = [answer]
    expect(await read(createUserTurnGuard())).toEqual([reply])
  })
})
