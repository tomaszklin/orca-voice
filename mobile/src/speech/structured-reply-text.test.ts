import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoReadAgentRow } from './auto-read-agent-rows'

const calls: { method: string; params: { itemId?: string } }[] = []
const replies = new Map<string, unknown>()

vi.mock('../session/native-chat/agent-session/mobile-structured-agent-session-rpc', () => ({
  callAgentSession: async (_client: unknown, method: string, params: { itemId?: string }) => {
    calls.push({ method, params })
    const reply = replies.get(method)
    if (reply instanceof Error) {
      throw reply
    }
    return reply
  }
}))
vi.mock('./speech-diagnostics', () => ({ logSpeechEvent: () => undefined }))

const { createStructuredTurnReader, endedTurnReplies, structuredSessionId } =
  await import('./structured-reply-text')

const client = {} as never
const session = 'claude_ceccd78e_c442_4f72_ba85_dff879fd4343'
const rawPaneKey = `structured-agent-session-${session}:861f66d8-f55f-4eb4-a882-6314809530ea`
const paneKey = `host:${rawPaneKey}`
// The owner's run plan (2026-11-08): four messages in a row, each turn starting about 2 s after the
// one before ended, so the row was `done` only in between.
const heartRate =
  'Biegniesz na tempo 4:05, a tętno tylko pilnuje. Do trzeciego kilometra tętno do 150, potem do 160.'
const paceTable = 'Tabela tempa jest poniżej, w trzech wariantach z czasem na każdym kilometrze.'
const negativeSplit =
  'Przerobiłem strategię na negative split. Pierwszą połowę biegniesz od 4:08 do 4:06.\n\n' +
  'Jeśli na piątym kilometrze tętno jest najwyżej 147, przyspieszasz mocniej.'

let sequence = 0

function turn(id: string, startedAt: number, completedAt?: number) {
  return {
    itemId: `turn-${id}`,
    sequence: ++sequence,
    observedAt: startedAt,
    body: {
      kind: 'turn',
      turnId: id,
      state: completedAt === undefined ? 'running' : 'completed',
      startedAt,
      ...(completedAt === undefined ? {} : { completedAt })
    }
  }
}

function message(id: string, role: string, text: string, turnId: string, observedAt: number) {
  return {
    itemId: id,
    sequence: ++sequence,
    observedAt,
    body: { kind: 'message', role, blocks: [{ type: 'text', text }] },
    turnScope: { kind: 'turn', turnItemId: `turn-${turnId}` }
  }
}

function history(...items: unknown[]) {
  replies.set('agentSession.history', { ok: true, page: { items } })
}

function row(state: 'working' | 'done', stateStartedAt: number, extra: object = {}) {
  return {
    paneKey,
    rawPaneKey,
    parentPaneKey: null,
    state,
    stateStartedAt,
    mainAgent: { state, stateStartedAt },
    lastAssistantMessage: null,
    toolName: null,
    worktreeId: 'wt',
    project: 'Running',
    ...extra
  } as AutoReadAgentRow
}

beforeEach(() => {
  calls.length = 0
  replies.clear()
})

describe('structured chat turns', () => {
  it('finds the session in a structured pane key, and none in a terminal one', () => {
    expect(structuredSessionId(rawPaneKey)).toBe(session)
    expect(structuredSessionId('tab-1:0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')).toBeNull()
  })

  it('takes the last reply of each ended turn, a turn off the page ended by the next one', () => {
    const items = [
      message('a1', 'assistant', 'Zbieram dane.', 'one', 5),
      message('a2', 'assistant', heartRate, 'one', 9),
      turn('two', 12, 20),
      message('u2', 'user', 'Zrób też strategię tempa', 'two', 12),
      message('a3', 'assistant', paceTable, 'two', 19),
      turn('three', 22),
      message('a4', 'assistant', 'Plan zapisany.', 'three', 25)
    ] as never[]
    expect(endedTurnReplies(items, 0).map(({ message, endedAt }) => [message, endedAt])).toEqual([
      [heartRate, 9],
      [paceTable, 20]
    ])
    expect(endedTurnReplies(items, 9).map(({ message }) => message)).toEqual([paceTable])
  })

  it("ends the last turn when the row's agent is done, though its row is off the page", () => {
    const items = [message('a1', 'assistant', negativeSplit, 'one', 30)] as never[]
    expect(endedTurnReplies(items, 0)).toEqual([])
    expect(endedTurnReplies(items, 0, 34).map(({ endedAt }) => endedAt)).toEqual([34])
  })

  it('reads every reply of turns that ended between two polls, each once and whole', async () => {
    const reader = createStructuredTurnReader()
    // First sight, mid-turn: only what ends from now on.
    const first = await reader.replies(client, [row('working', 100)], [])
    first.commit()
    expect(first.replies).toEqual([])
    expect(calls).toEqual([])

    history(
      turn('one', 100, 160),
      message('a1', 'assistant', heartRate, 'one', 159),
      turn('two', 162, 200),
      message('a2', 'assistant', paceTable, 'two', 199),
      turn('three', 202),
      message('a3', 'assistant', 'Plan zapisany.', 'three', 230)
    )
    const second = await reader.replies(client, [row('working', 202)], [])
    second.commit()
    expect(second.replies).toEqual([
      { paneKey, message: heartRate, endedAt: 160 },
      { paneKey, message: paceTable, endedAt: 200 }
    ])

    history(
      turn('two', 162, 200),
      message('a2', 'assistant', paceTable, 'two', 199),
      turn('three', 202, 290),
      message('a4', 'assistant', negativeSplit, 'three', 288)
    )
    const preview = negativeSplit.slice(0, 60)
    const third = await reader.replies(
      client,
      [row('done', 290)],
      [{ paneKey, message: preview, endedAt: 290 }]
    )
    third.commit()
    expect(third.replies).toEqual([{ paneKey, message: negativeSplit, endedAt: 290 }])

    calls.length = 0
    expect((await reader.replies(client, [row('done', 290)], [])).replies).toEqual([])
    expect(calls).toEqual([])
  })

  it('keeps nothing as read until the poll commits', async () => {
    const reader = createStructuredTurnReader()
    ;(await reader.replies(client, [row('working', 100)], [])).commit()
    history(turn('one', 100, 160), message('a1', 'assistant', heartRate, 'one', 159))
    await reader.replies(client, [row('working', 170)], [])
    const again = await reader.replies(client, [row('working', 170)], [])
    expect(again.replies.map(({ message }) => message)).toEqual([heartRate])
  })

  it('asks for the whole message when the page carried a shortened copy', async () => {
    const reader = createStructuredTurnReader()
    history(turn('one', 100, 160), {
      ...message('a1', 'assistant', negativeSplit.slice(0, 40), 'one', 159),
      shortened: true
    })
    replies.set('agentSession.item', {
      item: message('a1', 'assistant', negativeSplit, 'one', 159)
    })
    const found = [{ paneKey, message: negativeSplit.slice(0, 30), endedAt: 160 }]
    const result = await reader.replies(client, [row('done', 160)], found)
    expect(result.replies.map(({ message }) => message)).toEqual([negativeSplit])
    expect(calls.at(-1)).toEqual({
      method: 'agentSession.item',
      params: { sessionId: session, itemId: 'a1' }
    })
  })

  it("reads the row's reply whole when its chat has no turn rows", async () => {
    const reader = createStructuredTurnReader()
    history({
      ...message('a1', 'assistant', negativeSplit, 'one', 159),
      turnScope: { kind: 'thread' }
    })
    const found = [{ paneKey, message: negativeSplit.slice(0, 50), endedAt: 160 }]
    const result = await reader.replies(client, [row('done', 160)], found)
    expect(result.replies).toEqual([{ paneKey, message: negativeSplit, endedAt: 160 }])
  })

  it("reads the row's preview when the chat cannot be read", async () => {
    const reader = createStructuredTurnReader()
    replies.set('agentSession.history', new Error('structured_agent_session_unsupported'))
    const found = [{ paneKey, message: 'Preview.', endedAt: 160 }]
    const result = await reader.replies(client, [row('done', 160)], found)
    expect(result.replies).toEqual(found)
  })

  it('holds a turn back while its subagents run, and drops it for the turn that follows', async () => {
    const reader = createStructuredTurnReader()
    ;(await reader.replies(client, [row('working', 100)], [])).commit()
    history(turn('one', 100, 160), message('a1', 'assistant', 'Wracam, gdy skończą.', 'one', 159))
    const waiting = row('done', 160, { subagents: [{ state: 'working' }] })
    const held = await reader.replies(client, [waiting], [])
    held.commit()
    expect(held.replies).toEqual([])

    history(
      turn('one', 100, 160),
      message('a1', 'assistant', 'Wracam, gdy skończą.', 'one', 159),
      turn('two', 170, 200),
      message('a2', 'assistant', paceTable, 'two', 199)
    )
    const after = await reader.replies(
      client,
      [row('done', 200)],
      [{ paneKey, message: paceTable, endedAt: 200 }]
    )
    expect(after.replies.map(({ message }) => message)).toEqual([paceTable])
  })

  it('leaves terminal panes alone', async () => {
    const reader = createStructuredTurnReader()
    const terminal = {
      ...row('done', 50),
      paneKey: 'host:tab-1:leaf',
      rawPaneKey: 'tab-1:0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
    }
    const found = [{ paneKey: 'host:tab-1:leaf', message: 'Terminal reply.', endedAt: 50 }]
    const result = await reader.replies(client, [terminal], found)
    expect(result.replies).toEqual(found)
    expect(calls).toEqual([])
  })
})
