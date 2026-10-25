import * as DocumentPicker from 'expo-document-picker'
import { File as FsFile } from 'expo-file-system'
import { CLIPBOARD_IMAGE_MAX_SOURCE_BYTES } from '../../../src/shared/clipboard-image'
import {
  ChatFileTooLargeError,
  type ChatFilePicker,
  type PickedChatFile
} from './chat-file-picker-contract'

async function pickChatFile(): Promise<PickedChatFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: false,
    copyToCacheDirectory: true
  })
  const asset = result.canceled ? undefined : result.assets[0]
  if (!asset) {
    return null
  }
  const file = new FsFile(asset.uri)
  if (file.size > CLIPBOARD_IMAGE_MAX_SOURCE_BYTES) {
    throw new ChatFileTooLargeError()
  }
  return {
    base64: await file.base64(),
    mime: asset.mimeType ?? 'application/octet-stream',
    name: asset.name
  }
}

export function useChatFilePicker(): ChatFilePicker {
  return pickChatFile
}
