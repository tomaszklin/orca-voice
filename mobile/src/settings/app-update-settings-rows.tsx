import { Text } from 'react-native'
import { ListRow } from '../components/list/ListGroup'
import type { KnownAppUpdate } from '../storage/app-update-preferences'
import { colors } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { SettingsSection } from './settings-screen-frame'

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
    <SettingsSection>
      <ListRow
        key="version"
        title={label}
        {...(available && !checking
          ? { accessory: <Text style={styles.actionValue}>{value}</Text> }
          : { value })}
        accessibilityLabel={`${label}, ${value}`}
        busy={checking}
        onPress={() => (available ? onUpdate(available.url) : onCheck())}
      />
    </SettingsSection>
  )
}

const styles = themedStyleSheet(() => ({
  actionValue: { fontSize: 15, fontWeight: '600', color: colors.textPrimary }
}))
