import { createContext, useCallback, useState } from 'react'
import { saveMobileClipboardImageAsTempFile } from '../session/mobile-clipboard-image'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useChatFilePicker } from './chat-file-picker'
import { ChatFileTooLargeError } from './chat-file-picker-contract'
import { appendChatFileReference, buildChatFileReference } from './chat-file-reference'

export type ChatFileAttach = {
  readonly available: boolean
  readonly isAttaching: boolean
  readonly attachFile: () => Promise<void>
}

/** Provided by the session screen, read by the chat composer's paperclip button. */
export const ChatFileAttachContext = createContext<ChatFileAttach | null>(null)

/** Orca Voice fork: any file from the phone, uploaded to the host and referenced in the draft. */
export function useChatFileAttach({
  client,
  connState,
  getConnectionId,
  setComposerText,
  showToast
}: {
  client: RpcClient | null
  connState: ConnectionState
  getConnectionId: () => Promise<string | null>
  setComposerText: (update: (draft: string) => string) => void
  showToast: (message: string, durationMs?: number) => void
}): ChatFileAttach {
  const pickFile = useChatFilePicker()
  const [isAttaching, setIsAttaching] = useState(false)
  const available = client !== null && connState === 'connected'

  const attachFile = useCallback(async () => {
    if (!client || !available) {
      return
    }
    try {
      const file = await pickFile()
      if (!file) {
        return
      }
      setIsAttaching(true)
      const path = await saveMobileClipboardImageAsTempFile(client, file.base64, {
        connectionId: await getConnectionId()
      })
      setComposerText((draft) =>
        appendChatFileReference(draft, buildChatFileReference({ ...file, path }))
      )
    } catch (error) {
      showToast(
        error instanceof ChatFileTooLargeError
          ? 'File too large to attach (max 18 MB)'
          : 'Attach failed',
        2000
      )
    } finally {
      setIsAttaching(false)
    }
  }, [available, client, getConnectionId, pickFile, setComposerText, showToast])

  return { available, isAttaching, attachFile }
}
