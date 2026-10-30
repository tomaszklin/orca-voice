import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatFileAttach } from './use-chat-file-attach'
import {
  resetMobileNativeChatDraftStoreForTests,
  setMobileNativeChatDraftText,
  useMobileNativeChatDraft
} from '../session/native-chat/composer/mobile-native-chat-draft-store'
import type { PickedMobileFile } from '../platform/media-picker-contract'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'

// vitest.setup.ts stubs this hook for the chat suites; this suite is its own.
vi.unmock('./use-chat-file-attach')

const picker = vi.hoisted(() => ({ pickFiles: vi.fn() }))
vi.mock('../platform/media-picker', () => ({ useMediaPicker: () => picker }))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }
}))

const DRAFT = 'host\0worktree\0tab-a'
const OTHER_DRAFT = 'host\0worktree\0tab-b'

function file(name: string): PickedMobileFile {
  return { name, mime: 'application/pdf', byteLength: 3, base64: 'YWJj' }
}

function reference(name: string): string {
  return `[File from my phone, saved on this computer as \`/tmp/orca-paste-1/${name}\`]`
}

async function* picked(...files: PickedMobileFile[]) {
  yield* files
}

type Request = { method: string; params: unknown }

function hostClient(commit: (requests: Request[]) => Promise<string> | string) {
  const requests: Request[] = []
  const client = {
    sendRequest: vi.fn(async (method: string, params: unknown): Promise<RpcResponse> => {
      requests.push({ method, params })
      const result =
        method === 'clipboard.startImageUpload'
          ? { uploadId: `upload-${requests.length}` }
          : method === 'clipboard.commitImageUpload'
            ? await commit(requests)
            : { receivedBase64Length: 4 }
      return { id: 'r', ok: true, result, _meta: { runtimeId: 'r' } }
    })
  } as unknown as RpcClient
  return { client, requests }
}

describe('useChatFileAttach', () => {
  let renderer: ReactTestRenderer | null = null
  let attach: () => Promise<void> = async () => {}
  const drafts = { asking: '', other: '' }
  const showToast = vi.fn()

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    showToast.mockClear()
    picker.pickFiles.mockReset()
    resetMobileNativeChatDraftStoreForTests()
  })

  function Harness(props: { client: RpcClient; draftKey: string | null }): null {
    attach = useChatFileAttach({
      client: props.client,
      connState: 'connected',
      getConnectionId: async () => null,
      getDraftKey: () => props.draftKey,
      showToast
    }).attachFile
    drafts.asking = useMobileNativeChatDraft(DRAFT)
    drafts.other = useMobileNativeChatDraft(OTHER_DRAFT)
    return null
  }

  async function mount(client: RpcClient, draftKey: string | null = DRAFT): Promise<void> {
    await act(async () => {
      renderer = create(createElement(Harness, { client, draftKey }))
    })
  }

  it('uploads a file under its own name and references it at the end of the draft', async () => {
    const { client, requests } = hostClient(() => '/tmp/orca-paste-1/spec.pdf')
    picker.pickFiles.mockReturnValue(picked(file('spec.pdf')))
    setMobileNativeChatDraftText(DRAFT, 'Summarize')
    await mount(client)

    await act(() => attach())

    expect(requests[0]).toMatchObject({
      method: 'clipboard.startImageUpload',
      params: { fileName: 'spec.pdf' }
    })
    expect(drafts.asking).toBe(`Summarize ${reference('spec.pdf')} `)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('leaves the reference in the chat that asked after a tab switch', async () => {
    let finishCommit = (_path: string) => {}
    const { client } = hostClient(
      () =>
        new Promise<string>((resolve) => {
          finishCommit = resolve
        })
    )
    picker.pickFiles.mockReturnValue(picked(file('spec.pdf')))
    await mount(client)

    const attaching = attach()
    await vi.waitFor(() => expect(client.sendRequest).toHaveBeenCalledTimes(3))
    await act(async () => {
      renderer!.update(createElement(Harness, { client, draftKey: OTHER_DRAFT }))
    })
    finishCommit('/tmp/orca-paste-1/spec.pdf')
    await act(() => attaching)

    expect(drafts.asking).toBe(`${reference('spec.pdf')} `)
    expect(drafts.other).toBe('')
  })

  it('keeps the earlier file when a later one fails, and names the one that failed', async () => {
    const { client } = hostClient((requests) => {
      const commits = requests.filter(({ method }) => method.endsWith('commitImageUpload'))
      if (commits.length === 2) {
        throw new Error('disk full')
      }
      return '/tmp/orca-paste-1/first.pdf'
    })
    picker.pickFiles.mockReturnValue(picked(file('first.pdf'), file('second.pdf')))
    await mount(client)

    await act(() => attach())

    expect(drafts.asking).toBe(`${reference('first.pdf')} `)
    expect(showToast).toHaveBeenCalledWith("Couldn't upload second.pdf", 2000)
  })

  it('asks the agent for a copy when an older host saved the file as .png', async () => {
    const { client } = hostClient(() => 'C:\\Temp\\orca-paste-1730-ab12.png')
    picker.pickFiles.mockReturnValue(picked(file('spec.pdf')))
    await mount(client)

    await act(() => attach())

    expect(drafts.asking).toContain('copy it to a .pdf file before opening it')
  })

  it('opens no picker without a draft to fill', async () => {
    const { client } = hostClient(() => '/tmp/orca-paste-1/spec.pdf')
    await mount(client, null)

    await act(() => attach())

    expect(picker.pickFiles).not.toHaveBeenCalled()
  })
})
