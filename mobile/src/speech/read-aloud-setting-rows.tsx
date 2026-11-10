import { View, Text, Pressable } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { MobileSwitch } from '../components/MobileSwitch'
import { readAloudScreenStyles as styles } from './read-aloud-screen-styles'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'

export type Option<T extends string> = { value: T; label: string; sublabel?: string }

/** Orca Voice fork: a Read aloud setting picked in a drawer; the row shows the current choice. */
export function ChoiceRow({
  label,
  value,
  onPress,
  disabled = false
}: {
  label: string
  value: string
  onPress: () => void
  disabled?: boolean
}) {
  useMobileColorScheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={styles.row}
      onPress={onPress}
    >
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSublabel}>{value}</Text>
      </View>
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  )
}

/** Orca Voice fork: an on/off Read aloud setting, with an optional short note below the label. */
export function SwitchRow({
  label,
  sublabel,
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel = label
}: {
  label: string
  sublabel?: string
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
  accessibilityLabel?: string
}) {
  useMobileColorScheme()
  return (
    <View style={styles.row}>
      <View style={styles.rowContent}>
        <Text style={styles.rowLabel}>{label}</Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      <MobileSwitch
        accessibilityLabel={accessibilityLabel}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
      />
    </View>
  )
}
