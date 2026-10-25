import { useContext } from 'react'
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native'
import { Paperclip } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { ChatFileAttachContext } from './use-chat-file-attach'

/** Orca Voice fork: paperclip beside the composer's image button; renders nothing without a provider. */
export function ChatFileAttachButton({
  style,
  pressedStyle,
  disabled
}: {
  style: StyleProp<ViewStyle>
  pressedStyle: StyleProp<ViewStyle>
  disabled: boolean
}): React.JSX.Element | null {
  const fileAttach = useContext(ChatFileAttachContext)
  if (!fileAttach?.available) {
    return null
  }
  return (
    <Pressable
      accessibilityLabel="Attach file"
      style={({ pressed }) => [style, pressed && pressedStyle]}
      onPress={() => void fileAttach.attachFile()}
      disabled={disabled || fileAttach.isAttaching}
    >
      {fileAttach.isAttaching ? (
        <ActivityIndicator size="small" color={colors.textSecondary} />
      ) : (
        <Paperclip size={20} color={colors.textSecondary} strokeWidth={2} />
      )}
    </Pressable>
  )
}
