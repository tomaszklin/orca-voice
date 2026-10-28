import { vi } from 'vitest'

// Native SVG's generated components import Flow-only native subpaths outside the RN host mocks.
vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Defs: 'Defs',
  G: 'G',
  LinearGradient: 'LinearGradient',
  Path: 'Path',
  Rect: 'Rect',
  Stop: 'Stop'
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// Orca Voice fork: the chat's Read button renders a Pressable and a lucide icon, which the chat
// suites' own react-native and lucide mocks do not carry. It is the fork's, so it stays out of
// upstream's suites rather than every one of them growing two more mock members.
vi.mock('./src/components/MobileReplyReadButton', () => ({ MobileReplyReadButton: () => null }))
// The attach-file hook reaches the Expo pickers, which need the React Native runtime.
vi.mock('./src/file-attach/use-chat-file-attach', () => ({ useChatFileAttach: () => null }))
