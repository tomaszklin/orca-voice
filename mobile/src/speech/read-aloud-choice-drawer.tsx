import type { ReactNode } from 'react'
import { View, Text } from 'react-native'
import { BottomDrawer } from '../components/bottom-drawer/BottomDrawer'
import { LIST_ROW_PADDING, ListGroup, ListRow } from '../components/list/ListGroup'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import type { Option } from './read-aloud-setting-rows'

/**
 * Orca Voice fork: PickerModal's drawer with room for one more setting below the list
 * (What to read keeps its "Replies you did not ask for" switch there).
 */
export function ChoiceDrawer({
  visible,
  title,
  note,
  options,
  selected,
  onSelect,
  onClose,
  footer
}: {
  visible: boolean
  title: string
  note?: string
  options: readonly Option<string>[]
  selected: string
  onSelect: (value: string) => void
  onClose: () => void
  footer?: ReactNode
}) {
  useMobileColorScheme()
  return (
    <BottomDrawer visible={visible} onClose={onClose}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      <View style={styles.content}>
        <ListGroup separatorInset={LIST_ROW_PADDING}>
          {options.map((option) => (
            <ListRow
              key={option.value}
              title={option.label}
              subtitle={option.sublabel}
              selected={option.value === selected}
              accessibilityRole="button"
              onPress={() => {
                onSelect(option.value)
                onClose()
              }}
            />
          ))}
        </ListGroup>
        {footer ? <ListGroup separatorInset={LIST_ROW_PADDING}>{footer}</ListGroup> : null}
      </View>
    </BottomDrawer>
  )
}

const styles = themedStyleSheet(() => ({
  header: {
    paddingHorizontal: LIST_ROW_PADDING,
    paddingBottom: spacing.sm
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary
  },
  note: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    marginTop: 2
  },
  content: {
    gap: spacing.sm
  }
}))
