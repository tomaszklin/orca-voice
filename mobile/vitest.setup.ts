import { vi } from 'vitest'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// Orca Voice fork: the chat's Read and attach-file buttons render a Pressable and a lucide icon,
// which the chat suites' own react-native and lucide mocks do not carry. They are the fork's, so
// they stay out of upstream's suites rather than every one of them growing more mock members.
vi.mock('./src/components/MobileReplyReadButton', () => ({
  MobileReplyReadButton: () => null
}))
vi.mock('./src/file-attach/ChatFileAttachButton', () => ({
  ChatFileAttachButton: () => null
}))
// Its native half imports expo-document-picker, which needs the React Native runtime.
vi.mock('./src/file-attach/chat-file-picker', () => ({
  useChatFilePicker: () => () => Promise.resolve(null)
}))
