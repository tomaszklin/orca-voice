import { Pressable, Text } from 'react-native'
import { Volume2 } from 'lucide-react-native'
import { useReplySpeech } from '../platform/reply-speech'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { scaledType } from '../session/native-chat/transcript/mobile-native-chat-message-styles'

/**
 * Orca Voice fork: "Read" under an assistant reply, beside Copy. Reads the reply aloud with the
 * phone's voice; the Stop pill the shell shows while speaking ends it. Not drawn where the shell
 * cannot speak. Shown dimmed while the reply still streams, so the row does not shift when it ends.
 */
export function MobileReplyReadButton({
  id,
  text,
  fontScale = 1,
  disabled = false
}: {
  id: string
  text: string
  /** The transcript's text scale, so the label sits on the message time's baseline. */
  fontScale?: number
  disabled?: boolean
}): React.JSX.Element | null {
  useMobileColorScheme()
  const speech = useReplySpeech()
  if (!speech.canSpeak || text.length === 0) {
    return null
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Read reply aloud"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && styles.pressed
      ]}
      onPress={() => speech.speak(id, text)}
    >
      {/* Copy's icon size, and the time's type, so the footer row lines up (owner, 2026-10-29). */}
      <Volume2 size={14} color={colors.textMuted} />
      <Text style={[styles.label, scaledType(typography.metaSize, fontScale, 5)]}>Read</Text>
    </Pressable>
  )
}

const styles = themedStyleSheet(() => ({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.card
  },
  disabled: {
    opacity: 0.4
  },
  pressed: {
    opacity: 0.6
  },
  label: {
    color: colors.textMuted
  }
}))
