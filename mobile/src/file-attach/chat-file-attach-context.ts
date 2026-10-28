import { createContext } from 'react'

// Orca Voice fork. Kept apart from the hook so the composer can read it without the picker's
// Expo imports.

export type ChatFileAttach = {
  readonly available: boolean
  readonly isAttaching: boolean
  readonly attachFile: () => Promise<void>
}

/** Provided by the session screen, read by the chat composer's + sheet. */
export const ChatFileAttachContext = createContext<ChatFileAttach | null>(null)
