import { useCallback, useState } from 'react'
import { saveMobileClipboardImageAsTempFile } from '../session/mobile-clipboard-image'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMediaPicker } from '../platform/media-picker'
import { MobileFileTooLargeError } from '../platform/media-picker-contract'
import type { ChatFileAttach } from './chat-file-attach-context'
import { appendChatFileReference, buildChatFileReference } from './chat-file-reference'

/**
 * Orca Voice fork: any file from the phone, uploaded to the host and referenced in the draft.
 * The clipboard upload is the one a desktop older than v1.4.240 lets a phone use.
 */
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
  const picker = useMediaPicker()
  const [isAttaching, setIsAttaching] = useState(false)
  const available = client !== null && connState === 'connected'

  const attachFile = useCallback(async () => {
    if (!client || !available) {
      return
    }
    try {
      for await (const file of picker.pickFiles()) {
        setIsAttaching(true)
        const path = await saveMobileClipboardImageAsTempFile(client, file.base64, {
          connectionId: await getConnectionId(),
          fileName: file.name
        })
        setComposerText((draft) =>
          appendChatFileReference(
            draft,
            buildChatFileReference({ path, mime: file.mime, name: file.name })
          )
        )
      }
    } catch (error) {
      showToast(error instanceof MobileFileTooLargeError ? error.message : 'Attach failed', 2000)
    } finally {
      setIsAttaching(false)
    }
  }, [available, client, getConnectionId, picker, setComposerText, showToast])

  return { available, isAttaching, attachFile }
}
