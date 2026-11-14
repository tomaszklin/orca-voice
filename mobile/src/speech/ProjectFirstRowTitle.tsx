import { Text, type StyleProp, type TextStyle } from 'react-native'
import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { colors } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'
import type { projectFirstRow } from './project-first-labels'

/** Orca Voice fork: a workspace row's title, quiet or gone when it would repeat its project header. */
export function ProjectFirstRowTitle(props: {
  look: ReturnType<typeof projectFirstRow>
  style: StyleProp<TextStyle>
}) {
  const t = useMobileTranslation()
  if (props.look.hideTitle) {
    return null
  }
  return (
    <Text style={[props.style, props.look.titleRepeats && styles.quiet]} numberOfLines={1}>
      {props.look.titleRepeats
        ? t('components.worktreeListRow.noAgents', 'No agents')
        : props.look.title}
    </Text>
  )
}

const styles = themedStyleSheet(() => ({
  quiet: { fontWeight: '400', color: colors.textMuted }
}))
