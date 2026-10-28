import { describe, expect, it, vi } from 'vitest'

vi.mock('lucide-react-native', () => ({
  AtSign: 'AtSign',
  Image: 'Image',
  Package: 'Package',
  Paperclip: 'Paperclip',
  Terminal: 'Terminal'
}))

const { terminalChatAttachActions } = await import('./terminal-chat-attach-actions')

describe('terminalChatAttachActions', () => {
  it('keeps the official Photos and Files rows', () => {
    const onPhotos = vi.fn()
    const onFiles = vi.fn()
    const actions = terminalChatAttachActions(onPhotos, onFiles)
    expect(actions.map((action) => action.label)).toEqual(['Photos', 'Files'])
    actions[1]!.onPress()
    expect(onFiles).toHaveBeenCalledOnce()
  })

  it('offers Files alone when the chat takes no images', () => {
    expect(terminalChatAttachActions(undefined, vi.fn()).map((action) => action.label)).toEqual([
      'Files'
    ])
  })
})
