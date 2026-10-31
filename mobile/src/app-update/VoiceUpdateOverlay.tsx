import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { useVoiceUpdateStatus, voiceUpdateInstaller } from './voice-update-install'

const FINISHED_PHASES = {
  allow: { title: 'Allow Orca to install updates', action: 'Open settings' },
  ready: { title: 'Update downloaded', action: 'Install' },
  failed: { title: 'Update failed', action: 'Try again' }
}

/**
 * Mounted once above the navigator, so an update's progress shows over whatever screen is open,
 * including the pages the desktop serves.
 */
export function VoiceUpdateOverlay(): React.JSX.Element | null {
  useMobileColorScheme()
  const status = useVoiceUpdateStatus()
  const insets = useSafeAreaInsets()
  if (status.phase === 'idle') {
    return null
  }
  const layer = [styles.layer, { bottom: insets.bottom + spacing.md }]
  if (status.phase === 'downloading') {
    return (
      <View pointerEvents="box-none" style={layer}>
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: status.percent }}
          style={styles.card}
        >
          <View style={styles.row}>
            <Text style={styles.title}>Downloading update</Text>
            <Text style={styles.value}>{status.percent}%</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${status.percent}%` }]} />
          </View>
        </View>
      </View>
    )
  }
  const { title, action } = FINISHED_PHASES[status.phase]
  return (
    <View pointerEvents="box-none" style={layer}>
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.text}>
            <Text style={styles.title}>{title}</Text>
            {status.phase === 'failed' ? (
              <Text style={styles.value} numberOfLines={2}>
                {status.message}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            onPress={() => voiceUpdateInstaller.install(status.url)}
          >
            <Text style={styles.actionLabel}>{action}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss update"
            hitSlop={8}
            style={({ pressed }) => pressed && styles.pressed}
            onPress={voiceUpdateInstaller.dismiss}
          >
            <X size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  layer: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg
  },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.bgRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md
  },
  text: { flex: 1, minWidth: 0 },
  title: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  value: { fontSize: typography.metaSize, color: colors.textSecondary },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.borderSubtle
  },
  fill: { height: '100%', backgroundColor: colors.textPrimary },
  action: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.textPrimary
  },
  actionLabel: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.bgBase
  },
  pressed: { opacity: 0.7 }
}))
