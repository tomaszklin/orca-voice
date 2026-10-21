import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Square } from 'lucide-react-native'
import { colors, spacing } from '../theme/mobile-theme'
import { stopSpeaking, useSpeakingReplyId } from './reply-speaker'
import { useAutoReadReplies } from './use-auto-read-replies'

/**
 * Mounted once above the navigator: drives auto-read and, while a reply is being read, shows a
 * Stop pill over whatever screen is open — including the pages the desktop serves, which the
 * shell cannot add controls to.
 */
export function ReplyReaderOverlay(): React.JSX.Element | null {
  useAutoReadReplies()
  const speaking = useSpeakingReplyId() !== null
  const insets = useSafeAreaInsets()
  if (!speaking) {
    return null
  }
  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + spacing.xs }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop reading reply"
        hitSlop={8}
        style={styles.pill}
        onPress={() => stopSpeaking('Stop button')}
      >
        <Square size={12} color={colors.textPrimary} />
        <Text style={styles.label}>Stop</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center'
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.bgRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textMuted
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary
  }
})
