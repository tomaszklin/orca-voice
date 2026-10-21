/**
 * Orca Voice fork: no mic in the chat composer (owner's choice, 2026-10-21). Orca's dictation needs
 * a speech model on the desktop, so a stray tap opened its setup sheet; the phone's own dictation
 * cannot be started from an app, and the keyboard's mic is one tap away from the text field.
 */
export const CHAT_MIC_HIDDEN = true
