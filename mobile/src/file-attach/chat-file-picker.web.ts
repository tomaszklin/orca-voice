import { useCallback } from 'react'
import {
  readStagedMediaItem,
  releaseAllStagedMedia
} from '../mobile-web-shell/bridge/staged-media-bytes'
import { NativeVerbError, useNativeVerbs } from '../mobile-web-shell/bridge/use-native-verbs'
import { ChatFileTooLargeError, type ChatFilePicker } from './chat-file-picker-contract'

/** The shell's Files picker already takes any type (`*\/*`); the image flow just never asks it. */
export function useChatFilePicker(): ChatFilePicker {
  const verbs = useNativeVerbs()
  return useCallback(async () => {
    let items
    try {
      items = await verbs.pickMedia('files', false)
    } catch (error) {
      if (error instanceof NativeVerbError && error.reason === 'native_media_too_large') {
        throw new ChatFileTooLargeError()
      }
      throw error
    }
    const [item] = items
    try {
      return item ? { base64: await readStagedMediaItem(verbs, item), mime: item.mime } : null
    } finally {
      await releaseAllStagedMedia(verbs, items)
    }
  }, [verbs])
}
