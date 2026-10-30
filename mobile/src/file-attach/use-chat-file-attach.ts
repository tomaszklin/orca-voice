import { useCallback, useState } from 'react'
import { createUuidV4 } from '../../../src/shared/uuid-v4'
import { saveMobileClipboardImageAsTempFile } from '../session/mobile-clipboard-image'
import { setMobileNativeChatDraftText } from '../session/native-chat/composer/mobile-native-chat-draft-store'
import { uploadPickedNativeChatFiles } from '../session/native-chat/composer/mobile-native-chat-file-attachment'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { useMediaPicker } from '../platform/media-picker'
import type { ChatFileAttach } from './chat-file-attach-context'
import { appendChatFileReference, buildChatFileReference } from './chat-file-reference'

const NOOP = (): void => {}

/**
 * Orca Voice fork: any file from the phone, uploaded to the host and referenced in the draft.
 * The clipboard upload is the one a desktop older than v1.4.240 lets a phone use.
 */
export function useChatFileAttach({
  client,
  connState,
  getConnectionId,
  getDraftKey,
  showToast
}: {
  client: RpcClient | null
  connState: ConnectionState
  getConnectionId: () => Promise<string | null>
  getDraftKey: () => string | null
  showToast: (message: string, durationMs?: number) => void
}): ChatFileAttach {
  const picker = useMediaPicker()
  const [isAttaching, setIsAttaching] = useState(false)
  const available = client !== null && connState === 'connected'

  const attachFile = useCallback(async () => {
    // Follow the chat that asked: a tab switch mid-upload must not move the path to another draft.
    const draftKey = getDraftKey()
    if (!client || !available || !draftKey) {
      return
    }
    try {
      await uploadPickedNativeChatFiles({
        picked: picker.pickFiles(),
        upload: async (file) => {
          const path = await saveMobileClipboardImageAsTempFile(client, file.base64, {
            connectionId: await getConnectionId(),
            fileName: file.name
          })
          setMobileNativeChatDraftText(draftKey, (draft) =>
            appendChatFileReference(
              draft,
              buildChatFileReference({ path, mime: file.mime, name: file.name })
            )
          )
          return { path, name: file.name, byteLength: file.byteLength }
        },
        nextId: createUuidV4,
        onPicked: () => setIsAttaching(true),
        onStored: NOOP,
        onFailed: NOOP,
        onError: (message) => showToast(message, 2000)
      })
    } finally {
      setIsAttaching(false)
    }
  }, [available, client, getConnectionId, getDraftKey, picker, showToast])

  return { available, isAttaching, attachFile }
}
