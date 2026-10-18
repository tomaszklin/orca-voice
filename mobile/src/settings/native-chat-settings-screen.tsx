import { View, Text, StyleSheet, Pressable, ScrollView, Switch } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { ChevronLeft } from 'lucide-react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { useMobileDefaultSessionViewPreference } from '../session/use-mobile-default-session-view-preference'
import { useAutoReadRepliesPreference } from '../speech/auto-read-preference'
import { useBuiltInPagePreference } from '../speech/built-in-page-preference'
import { useBackgroundReadingPreference } from '../speech/background-reading'
import { speakReply } from '../speech/reply-speaker'
import { describeSpeechDiagnostics, useSpeechDiagnostics } from '../speech/speech-diagnostics'

export default function NativeChatSettingsScreen({ onBack }: { onBack?: () => void }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const { defaultView, setDefaultView } = useMobileDefaultSessionViewPreference()
  const chatDefault = defaultView === 'chat'
  const { autoRead, setAutoRead } = useAutoReadRepliesPreference()
  const { builtInPage, setBuiltInPage } = useBuiltInPagePreference()
  const { backgroundReading, setBackgroundReading } = useBackgroundReadingPreference()
  const diagnostics = useSpeechDiagnostics()

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backButton}
          onPress={onBack ?? (() => router.back())}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Chat UI</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.groupHeading}>DEFAULT VIEW</Text>
        <Text style={styles.groupDescription}>
          Choose how supported agent sessions (Claude, Codex, and other chat-capable agents) open on
          this device. Terminal shows the raw CLI; Chat UI shows a chat interface like the desktop
          app. You can still switch any individual session from its long-press menu.
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Open sessions in Chat UI</Text>
              <Text style={styles.rowSublabel}>{chatDefault ? 'On' : 'Off'}</Text>
            </View>
            <Switch
              accessibilityLabel="Open sessions in Chat UI"
              value={chatDefault}
              onValueChange={(next) => setDefaultView(next ? 'chat' : 'terminal')}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
        </View>

        <Text style={[styles.groupHeading, styles.groupGap]}>READ REPLIES ALOUD</Text>
        <Text style={styles.groupDescription}>
          Replies are read with this device's text-to-speech voice; code blocks and tables are
          skipped, and a Stop button appears at the top while one is being read. The Read button
          under each reply comes with the built-in chat page. With auto-read on, each new reply is
          also read as soon as the agent finishes, on any screen, while Orca is open.
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Built-in chat page (Read buttons)</Text>
              <Text style={styles.rowSublabel}>
                {builtInPage
                  ? 'On — applies to screens opened from now on'
                  : 'Off — the page your desktop sends, without Read buttons'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Built-in chat page"
              value={builtInPage}
              onValueChange={setBuiltInPage}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Auto-read new replies</Text>
              <Text style={styles.rowSublabel}>{autoRead ? 'On' : 'Off'}</Text>
            </View>
            <Switch
              accessibilityLabel="Auto-read new replies"
              value={autoRead}
              onValueChange={setAutoRead}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Keep reading with the screen off</Text>
              <Text style={styles.rowSublabel}>
                {backgroundReading
                  ? 'On — while auto-read is on, a notification keeps Orca awake (uses more battery)'
                  : 'Off — auto-read stops when Orca leaves the screen'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Keep reading with the screen off"
              value={backgroundReading}
              onValueChange={setBackgroundReading}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            style={[styles.row, styles.rowDivider]}
            onPress={() =>
              speakReply(
                'settings-test',
                'Test czytania odpowiedzi. Test reading replies aloud.',
                'interrupt'
              )
            }
          >
            <Text style={styles.rowLabel}>Test voice</Text>
          </Pressable>
        </View>
        <Text style={styles.diagnostics} selectable>
          {describeSpeechDiagnostics(diagnostics, Constants.expoConfig?.extra?.voiceBuild)}
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.lg
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.lg
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary
  },
  groupHeading: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs
  },
  groupDescription: {
    fontSize: typography.bodySize - 1,
    color: colors.textSecondary,
    lineHeight: 20,
    paddingHorizontal: spacing.xs
  },
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: radii.card,
    overflow: 'hidden'
  },
  sectionTopGap: {
    marginTop: spacing.sm
  },
  groupGap: {
    marginTop: spacing.lg
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.bgRaised
  },
  diagnostics: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    fontSize: typography.bodySize - 3,
    lineHeight: 18,
    color: colors.textMuted
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowContent: {
    flex: 1
  },
  rowLabel: {
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  rowSublabel: {
    fontSize: typography.bodySize - 2,
    color: colors.textSecondary,
    marginTop: 2
  }
})
