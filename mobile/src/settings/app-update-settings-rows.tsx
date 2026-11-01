import { Pressable, Text, View } from 'react-native'
import type { KnownAppUpdate } from '../storage/app-update-preferences'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'

export type AppUpdateCheckRowStatus = 'idle' | 'checking' | 'up-to-date' | 'failed'

// Orca Voice fork: one row, the installed version on the left and the update state on the right.
function versionRowValue(
  status: AppUpdateCheckRowStatus,
  available: KnownAppUpdate | null,
  lastCheckedAt: number | null
) {
  if (status === 'checking') {
    return 'Checking…'
  }
  if (available) {
    return `Update to ${available.version}`
  }
  if (status === 'failed') {
    return "Couldn't check"
  }
  if (status === 'up-to-date' || lastCheckedAt !== null) {
    return 'Up to date'
  }
  return 'Check'
}

export function AppUpdateSettingsRows(props: {
  installedVersion: string | null
  available: KnownAppUpdate | null
  lastCheckedAt: number | null
  checkStatus: AppUpdateCheckRowStatus
  onUpdate: (url: string) => void
  onCheck: () => void
}) {
  useMobileColorScheme()
  const { available, onUpdate, onCheck } = props
  const checking = props.checkStatus === 'checking'
  const label = props.installedVersion ? `Version ${props.installedVersion}` : 'Version'
  const value = versionRowValue(props.checkStatus, available, props.lastCheckedAt)
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}`}
        accessibilityState={{ busy: checking }}
        disabled={checking}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => (available ? onUpdate(available.url) : onCheck())}
      >
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={available && !checking ? styles.actionValue : styles.rowValue}>{value}</Text>
      </Pressable>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: spacing.md
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: { backgroundColor: colors.bgRaised },
  rowLabel: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  rowValue: { fontSize: typography.metaSize, color: colors.textSecondary },
  actionValue: { fontSize: typography.bodySize, fontWeight: '600', color: colors.textPrimary }
}))
