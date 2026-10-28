import { vi } from 'vitest'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

// Orca Voice fork: the chat's Read button renders a Pressable and a lucide icon, which the chat
// suites' own react-native and lucide mocks do not carry. It is the fork's, so it stays out of
// upstream's suites rather than every one of them growing two more mock members.
vi.mock('./src/components/MobileReplyReadButton', () => ({ MobileReplyReadButton: () => null }))
