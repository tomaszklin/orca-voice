import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_STATUS_MAX_FIELD_LENGTH,
  normalizeOptionalField
} from '../../../src/shared/agent-status-field-normalization'

const calls: { method: string; params: { itemId?: string } }[] = []
const replies = new Map<string, unknown>()

vi.mock('../session/mobile-structured-agent-session-rpc', () => ({
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

const { structuredSessionId, wholeStructuredReply, withWholeStructuredReplies } =
  await import('./structured-reply-text')

const client = {} as never
const session = 'claude_23c7a903-1d2e-4f50-8a6b-9c7d0e1f2a3b'
const rawPaneKey = `structured-agent-session-${session}:0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d`
// The reply the owner heard cut off (2026-11-03), and the preview its row carried.
const whole =
  'Musicie kupić z wyprzedzeniem dwie rzeczy: Parlament i Szpital w Skale. W Parlamencie ' +
  'wchodzi się na bilet na konkretną godzinę, a terminy szybko się wyprzedają. Kupiłbym je ' +
  'dziś, bo w planie jesteście tam w piątek o 10:15.\n\nSzpital w Skale to zwiedzanie z ' +
  'przewodnikiem, też na godzinę: w piątek o 14:00.'
const preview = normalizeOptionalField(whole, AGENT_STATUS_MAX_FIELD_LENGTH) ?? ''

function item(itemId: string, role: string, text: string, extra: object = {}) {
  return { itemId, body: { kind: 'message', role, blocks: [{ type: 'text', text }] }, ...extra }
}

function history(...items: unknown[]) {
  replies.set('agentSession.history', { ok: true, page: { items } })
}

beforeEach(() => {
  calls.length = 0
  replies.clear()
})

describe('structured chat replies', () => {
  it('finds the session in a structured pane key, and none in a terminal one', () => {
    expect(structuredSessionId(rawPaneKey)).toBe(session)
    expect(structuredSessionId('tab-1:0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')).toBeNull()
  })

  it('reads the whole reply the 200-character preview stands for', async () => {
    expect(preview.length).toBe(200)
    history(item('ask', 'user', 'Co kupić?'), item('answer', 'assistant', whole))
    expect(await wholeStructuredReply(client, session, preview)).toBe(whole)
  })

  it('asks for the whole item when the page carried a shortened copy', async () => {
    history(item('answer', 'assistant', whole.slice(0, 220), { shortened: true }))
    replies.set('agentSession.item', { item: item('answer', 'assistant', whole) })
    expect(await wholeStructuredReply(client, session, preview)).toBe(whole)
    expect(calls.at(-1)).toEqual({
      method: 'agentSession.item',
      params: { sessionId: session, itemId: 'answer' }
    })
  })

  it('keeps the preview when the newest reply is another one or the chat cannot be read', async () => {
    history(item('answer', 'assistant', 'Something newer.'))
    expect(await wholeStructuredReply(client, session, preview)).toBe(preview)
    history(item('answer', 'assistant', whole), item('next', 'user', 'A new question'))
    expect(await wholeStructuredReply(client, session, preview)).toBe(preview)
    replies.set('agentSession.history', new Error('structured_agent_session_unsupported'))
    expect(await wholeStructuredReply(client, session, preview)).toBe(preview)
  })

  it('leaves terminal panes alone', async () => {
    history(item('answer', 'assistant', whole))
    const rows = [
      { paneKey: 'host:structured', rawPaneKey },
      { paneKey: 'host:terminal', rawPaneKey: 'tab-1:0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d' }
    ]
    const result = await withWholeStructuredReplies(client, rows, [
      { paneKey: 'host:structured', message: preview, endedAt: 1 },
      { paneKey: 'host:terminal', message: 'Terminal reply.', endedAt: 2 }
    ])
    expect(result.map(({ message }) => message)).toEqual([whole, 'Terminal reply.'])
    expect(calls).toHaveLength(1)
  })
})
