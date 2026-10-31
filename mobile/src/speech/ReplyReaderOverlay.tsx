import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pause, Play, Square } from 'lucide-react-native'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { useReaderControls } from './reader-controls'
import { pauseReading, playReading, stopReading, useReaderState } from './reply-speaker'
import { useAutoReadReplies } from './use-auto-read-replies'

const MAIN_PILL = { reading: 'Pause', paused: 'Resume', stopped: 'Play' }

/**
 * Mounted once above the navigator: drives auto-read and the reading buttons, and while a reply is
 * being read shows Pause and Stop pills over whatever screen is open — including the pages the
 * desktop serves, which the shell cannot add controls to. Stopped with messages waiting, a Play
 * pill stays, as the notification exists only with screen-off reading.
 */
export function ReplyReaderOverlay(): React.JSX.Element | null {
  useMobileColorScheme()
  useAutoReadReplies()
  useReaderControls()
  const state = useReaderState()
  const insets = useSafeAreaInsets()
  if (state === 'idle') {
    return null
  }
  const reading = state === 'reading'
  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + spacing.xs }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${MAIN_PILL[state]} reading`}
        hitSlop={8}
        style={styles.pill}
        onPress={() => (reading ? pauseReading('Pause pill') : playReading('Play pill'))}
      >
        {reading ? (
          <Pause size={12} color={colors.textPrimary} />
        ) : (
          <Play size={12} color={colors.textPrimary} />
        )}
        <Text style={styles.label}>{MAIN_PILL[state]}</Text>
      </Pressable>
      {state === 'stopped' ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop reading reply"
          hitSlop={8}
          style={styles.pill}
          onPress={() => stopReading('Stop button')}
        >
          <Square size={12} color={colors.textPrimary} />
          <Text style={styles.label}>Stop</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm
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
    borderColor: colors.borderSubtle
  },
  label: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textPrimary
  }
}))
