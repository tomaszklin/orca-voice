import { useState } from 'react'
import { View, Text, Pressable, ScrollView, Switch } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { Check, ChevronLeft } from 'lucide-react-native'
import { colors, spacing } from '../theme/mobile-theme'
import type { ReadScope } from '../storage/speech-preferences'
import { setAutoReadMuted, useAutoReadMuted } from './auto-read-mute'
import { useAutoReadRepliesPreference } from './auto-read-preference'
import { useBuiltInPagePreference } from './built-in-page-preference'
import { useBackgroundReadingPreference } from './background-reading'
import { readAloudStyles as styles } from './read-aloud-settings-styles'
import {
  ReadAloudVoiceGroup,
  ReadAloudVoicePickers,
  type VoicePicker
} from './read-aloud-voice-settings'
import { useReadScopePreference } from './read-scope-preference'
import { describeSpeechDiagnostics, useSpeechDiagnostics } from './speech-diagnostics'
import { useSpeechOptions } from './speech-options'

const READ_SCOPES: { scope: ReadScope; label: string; sublabel: string }[] = [
  {
    scope: 'all',
    label: 'Every message',
    sublabel: 'Also what the agent writes while it is still working'
  },
  {
    scope: 'all-on-screen',
    label: 'Every message on screen, final replies off screen',
    sublabel: 'Everything while Orca is open; only the turn-ending answer with the screen off'
  },
  {
    scope: 'replies',
    label: 'Final replies only',
    sublabel: 'Only the answer that ends a turn, as in notifications'
  }
]

/** Orca Voice fork: every read-aloud option in one menu (Settings → Read aloud). */
export default function ReadAloudSettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { autoRead, setAutoRead } = useAutoReadRepliesPreference()
  const { builtInPage, setBuiltInPage } = useBuiltInPagePreference()
  const { backgroundReading, setBackgroundReading } = useBackgroundReadingPreference()
  const { readScope, setReadScope } = useReadScopePreference()
  const muted = useAutoReadMuted()
  const diagnostics = useSpeechDiagnostics()
  const speechOptions = useSpeechOptions()
  const [picker, setPicker] = useState<VoicePicker | null>(null)

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Read aloud</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.groupHeading}>READ BUTTON</Text>
        <Text style={styles.groupDescription}>
          Messages are read with the speed and voice set below; code blocks and tables are skipped,
          and a Stop button appears at the top while one is being read.
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
        </View>

        <ReadAloudVoiceGroup state={speechOptions} onOpenPicker={setPicker} />

        <Text style={[styles.groupHeading, styles.groupGap]}>AUTO-READ</Text>
        <Text style={styles.groupDescription}>
          New messages from every connected agent are read as they arrive, on any screen.
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <View style={styles.row}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Auto-read new messages</Text>
              <Text style={styles.rowSublabel}>{autoRead ? 'On' : 'Off'}</Text>
            </View>
            <Switch
              accessibilityLabel="Auto-read new messages"
              value={autoRead}
              onValueChange={setAutoRead}
              trackColor={{ false: colors.bgRaised, true: colors.textSecondary }}
              thumbColor={colors.textPrimary}
            />
          </View>
          <View style={[styles.row, styles.rowDivider]}>
            <View style={styles.rowContent}>
              <Text style={styles.rowLabel}>Mute for now</Text>
              <Text style={styles.rowSublabel}>
                {muted
                  ? 'Muted — until you unmute here or in the notification, or restart Orca'
                  : 'Also on the reading notification; a restart of Orca unmutes'}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Mute auto-read for now"
              value={muted}
              onValueChange={setAutoReadMuted}
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
        </View>

        <Text style={[styles.groupHeading, styles.groupGap]}>WHAT TO READ</Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          {READ_SCOPES.map((option, index) => {
            const selected = option.scope === readScope
            return (
              <Pressable
                key={option.scope}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                style={index === 0 ? styles.row : [styles.row, styles.rowDivider]}
                onPress={() => setReadScope(option.scope)}
              >
                <View style={styles.rowContent}>
                  <Text style={styles.rowLabel}>{option.label}</Text>
                  <Text style={styles.rowSublabel}>{option.sublabel}</Text>
                </View>
                {selected ? <Check size={18} color={colors.textPrimary} /> : null}
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.diagnostics} selectable>
          {describeSpeechDiagnostics(diagnostics, Constants.expoConfig?.extra?.voiceBuild)}
        </Text>
      </ScrollView>

      <ReadAloudVoicePickers
        state={speechOptions}
        picker={picker}
        onClose={() => setPicker(null)}
      />
    </View>
  )
}
