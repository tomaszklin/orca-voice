import { Pressable, StyleSheet, Text } from 'react-native'
import { Volume2 } from 'lucide-react-native'
import { useReplySpeech } from '../platform/reply-speech'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

/**
 * Orca Voice fork: "Read" under an assistant reply, beside Copy. Reads the reply aloud with the
 * phone's voice; the Stop pill the shell shows while speaking ends it. Not drawn where the shell
 * cannot speak.
 */
export function MobileReplyReadButton({
  id,
  text
}: {
  id: string
  text: string
}): React.JSX.Element | null {
  const speech = useReplySpeech()
  if (!speech.canSpeak || text.length === 0) {
    return null
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Read reply aloud"
      hitSlop={6}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      onPress={() => speech.speak(id, text)}
    >
      <Volume2 size={13} color={colors.textMuted} />
      <Text style={styles.label}>Read</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.card
  },
  pressed: {
    opacity: 0.6
  },
  label: {
    fontSize: typography.bodySize - 4,
    color: colors.textMuted
  }
})
