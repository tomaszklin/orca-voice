import { createElement, type ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileNativeChatComposer } from '../session/native-chat/composer/MobileNativeChatComposer'
import { ActionSheetModal } from '../components/ActionSheetModal'
import { ChatFileAttachContext, type ChatFileAttach } from './chat-file-attach-context'

vi.mock('react-native', async () => {
  const React = await import('react')
  return {
    ActivityIndicator: 'ActivityIndicator',
    Image: 'Image',
    Keyboard: { dismiss: vi.fn() },
    Pressable: 'Pressable',
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) =>
      React.createElement('ScrollView', props, children),
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View'
  }
})

vi.mock('lucide-react-native', () => ({
  ArrowUp: 'ArrowUp',
  AtSign: 'AtSign',
  Image: 'Image',
  Paperclip: 'Paperclip',
  Check: 'Check',
  ChevronDown: 'ChevronDown',
  ChevronLeft: 'ChevronLeft',
  ChevronRight: 'ChevronRight',
  FileText: 'FileText',
  Mic: 'Mic',
  Package: 'Package',
  Plus: 'Plus',
  ShieldAlert: 'ShieldAlert',
  Square: 'Square',
  Terminal: 'Terminal',
  X: 'X'
}))

vi.mock('../components/mounted-bottom-drawer', () => ({ MountedBottomDrawer: 'BottomDrawer' }))
vi.mock('../components/bottom-drawer-modal-host-scope', () => ({
  useBottomDrawerModalHost: () => null
}))

type ComposerProps = ComponentProps<typeof MobileNativeChatComposer>

describe('Orca Voice Files row in the chat composer', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  const draw = (attach: ChatFileAttach | null, props: Partial<ComposerProps> = {}) =>
    createElement(
      ChatFileAttachContext.Provider,
      { value: attach },
      createElement(MobileNativeChatComposer, {
        value: '',
        onChangeText: vi.fn(),
        onSend: vi.fn().mockResolvedValue(true),
        sendSurfaceId: 'tab-a',
        getSendCompletionGeneration: () => 0,
        getComposerEditGeneration: () => 0,
        agent: 'claude',
        ...props
      })
    )
  const labelled = (label: string) =>
    renderer!.root.findAll(
      (node) => node.props.accessibilityLabel === label && node.props.onPress !== undefined
    )
  const sheetRows = () =>
    renderer!.root
      .findAllByType(ActionSheetModal)
      .flatMap((sheet) => (sheet.props.actions as { label: string }[]).map((row) => row.label))
  const attach = (overrides: Partial<ChatFileAttach> = {}): ChatFileAttach => ({
    available: true,
    isAttaching: false,
    attachFile: vi.fn().mockResolvedValue(undefined),
    ...overrides
  })

  it('gives a terminal-backed chat a + sheet with Photos and Files', async () => {
    const onAttachImage = vi.fn()
    const fileAttach = attach()
    await act(async () => {
      renderer = create(draw(fileAttach, { onAttachImage }))
    })
    await act(async () => labelled('Add to message')[0]!.props.onPress())
    expect(onAttachImage).not.toHaveBeenCalled()
    expect(sheetRows()).toEqual(['Photos', 'Files'])
    const sheet = renderer!.root.findByType(ActionSheetModal)
    await act(async () =>
      (sheet.props.actions as { label: string; onPress: () => void }[])[1]!.onPress()
    )
    expect(fileAttach.attachFile).toHaveBeenCalledOnce()
  })

  it('keeps the official behaviour while disconnected', async () => {
    const onAttachImage = vi.fn()
    await act(async () => {
      renderer = create(draw(attach({ available: false }), { onAttachImage }))
    })
    await act(async () => labelled('Attach image')[0]!.props.onPress())
    expect(onAttachImage).toHaveBeenCalledOnce()
  })

  it('fills a structured chat’s Files row only when the host gave it none', async () => {
    const structured = {
      catalog: { reported: [], conversationCommands: [] },
      onSlashMenuOpen: vi.fn(),
      files: [],
      onRemoveFile: vi.fn()
    }
    const fileAttach = attach()
    await act(async () => {
      renderer = create(draw(fileAttach, { structured }))
    })
    const filesRow = () =>
      (
        renderer!.root.findByType(ActionSheetModal).props.actions as {
          label: string
          onPress: () => void
        }[]
      ).find((row) => row.label === 'Files')!
    await act(async () => filesRow().onPress())
    expect(fileAttach.attachFile).toHaveBeenCalledOnce()

    const official = vi.fn()
    await act(async () =>
      renderer!.update(draw(fileAttach, { structured: { ...structured, onAttachFiles: official } }))
    )
    await act(async () => filesRow().onPress())
    expect(official).toHaveBeenCalledOnce()
    expect(fileAttach.attachFile).toHaveBeenCalledOnce()
  })

  it('shows the spinner and holds Send while a file uploads', async () => {
    await act(async () => {
      renderer = create(draw(attach({ isAttaching: true }), { value: 'see this' }))
    })
    expect(renderer!.root.findAllByType('ActivityIndicator' as never)).toHaveLength(1)
    expect(labelled('Send message')[0]!.props.disabled).toBe(true)
  })
})
