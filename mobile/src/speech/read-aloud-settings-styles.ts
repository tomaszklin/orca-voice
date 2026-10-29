import { colors, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'

/** Orca Voice fork: what the Read aloud screen and its voice group add to voiceSettingsStyles. */
export const readAloudStyles = themedStyleSheet(() => ({
  groupDescription: {
    fontSize: typography.bodySize - 1,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingHorizontal: spacing.xs
  },
  groupGap: {
    marginTop: spacing.lg
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  }
}))
