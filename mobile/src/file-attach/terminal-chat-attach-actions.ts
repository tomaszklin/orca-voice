import type { ActionSheetAction } from '../components/ActionSheetModal'
import { mobileNativeChatAttachActions } from '../session/mobile-native-chat-attach-actions'

const NOOP = (): void => {}
const TERMINAL_CHAT_ROWS: ReadonlySet<string> = new Set(['Photos', 'Files'])

/** Orca Voice fork: a terminal-backed chat's + sheet, the official Photos and Files rows only. */
export function terminalChatAttachActions(
  onPhotos: (() => void) | undefined,
  onFiles: () => void
): ActionSheetAction[] {
  return mobileNativeChatAttachActions({
    onPhotos,
    onFiles,
    onWorkspaceFile: NOOP,
    onSkills: NOOP,
    onCommands: NOOP,
    skillCount: 0
  }).filter((action) => TERMINAL_CHAT_ROWS.has(action.label))
}
