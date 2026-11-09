import { useState } from 'react'
import { ActivityIndicator, Pressable } from 'react-native'
import { Plus } from 'lucide-react-native'
import { colors } from '../../../theme/mobile-theme'
import { useMobileTranslation } from '../../../i18n/use-mobile-translation'
import { ActionSheetModal } from '../../../components/ActionSheetModal'
import { mobileNativeChatAttachActions } from '../mobile-native-chat-attach-actions'
import { terminalChatAttachActions } from '../../../file-attach/terminal-chat-attach-actions'
import {
  COMPOSER_CONTROL_HIT_SLOP,
  composerInputStyles as inputStyles
} from '../../../components/composer-input/composer-input-styles'

/** The composer's + button: the add-to-message sheet in a structured chat, else the photo library. */
export function MobileNativeChatComposerAttachButton({
  onAttachImage,
  onAttachFiles,
  structured,
  isAttaching,
  disabled,
  menu,
  terminalFiles
}: {
  onAttachImage: (() => void) | undefined
  onAttachFiles: (() => void) | undefined
  structured: boolean
  isAttaching: boolean
  disabled: boolean
  menu: {
    openFileMenu: () => void
    openSlashMenu: (kind: 'skill' | 'command') => void
    skillCount: number
  }
  /** Orca Voice fork: Files for a terminal-backed chat, which then gets a Photos/Files sheet. */
  terminalFiles?: () => void
}): React.JSX.Element | null {
  const t = useMobileTranslation()
  const [attachOpen, setAttachOpen] = useState(false)
  // A terminal-backed chat has only photos to add, so its + opens the library at once.
  const sheet = structured || terminalFiles !== undefined
  const attachPress = sheet ? () => setAttachOpen(true) : onAttachImage
  if (!attachPress) {
    return null
  }
  return (
    <>
      <Pressable
        accessibilityLabel={
          sheet
            ? t('chat.composer.addToMessage', 'Add to message')
            : t('chat.composer.attachImage', 'Attach image')
        }
        style={({ pressed }) => [inputStyles.controlButton, pressed && inputStyles.pressed]}
        onPress={attachPress}
        disabled={isAttaching || disabled}
        hitSlop={COMPOSER_CONTROL_HIT_SLOP}
      >
        {isAttaching ? (
          <ActivityIndicator size="small" color={colors.textSecondary} />
        ) : (
          <Plus size={19} color={colors.textPrimary} strokeWidth={2} />
        )}
      </Pressable>
      {structured ? (
        <ActionSheetModal
          visible={attachOpen}
          onClose={() => setAttachOpen(false)}
          actions={mobileNativeChatAttachActions({
            onPhotos: onAttachImage,
            onFiles: onAttachFiles,
            onWorkspaceFile: menu.openFileMenu,
            onSkills: () => menu.openSlashMenu('skill'),
            onCommands: () => menu.openSlashMenu('command'),
            skillCount: menu.skillCount
          })}
        />
      ) : terminalFiles ? (
        <ActionSheetModal
          visible={attachOpen}
          onClose={() => setAttachOpen(false)}
          actions={terminalChatAttachActions(onAttachImage, terminalFiles)}
        />
      ) : null}
    </>
  )
}
