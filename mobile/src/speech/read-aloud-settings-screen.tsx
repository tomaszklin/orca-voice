import { useState } from 'react'
import { View, Text, Pressable, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { readAloudScreenStyles as styles } from './read-aloud-screen-styles'
import { colors, spacing } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'
import { useAnnounceWaits } from './agent-wait-announcement'
import { useOtherTurnReplies } from './user-turn-guard'
import { setAutoReadPaused, useAutoReadPaused } from './auto-read-pause'
import { useAutoReadRepliesPreference } from './auto-read-preference'
import { useBuiltInPagePreference } from './built-in-page-preference'
import { useBackgroundReadingPreference } from './background-reading'
import {
  CHIME_MODES,
  LINK_READINGS,
  PROJECT_NAME_MODES,
  READ_SCOPES,
  TABLE_READINGS
} from './read-aloud-choices'
import { OptionRows, SwitchRow } from './read-aloud-setting-rows'
import { readAloudStyles } from './read-aloud-settings-styles'
import {
  ReadAloudVoiceGroup,
  ReadAloudVoicePickers,
  type VoicePicker
} from './read-aloud-voice-settings'
import { useChimeMode, useProjectNameMode } from './project-name-announcement'
import { useReadScopePreference } from './read-scope-preference'
import { playChimeSample } from './reader-samples'
import { useHeadphonesOnly, useLinkReading, useTableReading } from './reading-preferences'
import { speakLinkSample, speakTableSample, useSpeechOptions } from './speech-options'
import { voiceNativeModule } from './voice-native-module'

/** Orca Voice fork: every option of auto-read but the switch itself, greyed out while it is off. */
function AutoReadOptions({ enabled }: { enabled: boolean }) {
  useMobileColorScheme()
  const { backgroundReading, setBackgroundReading } = useBackgroundReadingPreference()
  const { readScope, setReadScope } = useReadScopePreference()
  const { value: projectNameMode, setValue: setProjectNameMode } = useProjectNameMode()
  const { value: chimeMode, setValue: setChimeMode } = useChimeMode()
  const { value: announceWaits, setValue: setAnnounceWaits } = useAnnounceWaits()
  const { value: otherTurnReplies, setValue: setOtherTurnReplies } = useOtherTurnReplies()
  const { value: headphonesOnly, setValue: setHeadphonesOnly } = useHeadphonesOnly()
  const autoReadPaused = useAutoReadPaused()
  const disabled = !enabled
  // Why: screen-off reading and headphones-only need the Android reader; elsewhere they do nothing.
  const nativeReader = voiceNativeModule() !== null

  return (
    <View style={disabled && styles.disabled}>
      <View style={[styles.section, styles.sectionTopGap]}>
        <SwitchRow
          label="Pause auto-read"
          sublabel="You can also pause in the notification."
          value={autoReadPaused}
          onValueChange={setAutoReadPaused}
          disabled={disabled}
        />
        {nativeReader ? <View style={styles.separator} /> : null}
        {nativeReader ? (
          <SwitchRow
            label="Keep reading with the screen off"
            sublabel="Uses more battery."
            value={backgroundReading}
            onValueChange={setBackgroundReading}
            disabled={disabled}
          />
        ) : null}
        <View style={styles.separator} />
        <SwitchRow
          label="Say when an agent waits for you"
          sublabel="Says when an agent asks a question or needs permission."
          value={announceWaits === 'on'}
          onValueChange={(on) => setAnnounceWaits(on ? 'on' : 'off')}
          disabled={disabled}
        />
        <View style={styles.separator} />
        <SwitchRow
          label="Replies you did not ask for"
          sublabel="For example, when a background task ends."
          value={otherTurnReplies === 'on'}
          onValueChange={(on) => setOtherTurnReplies(on ? 'on' : 'off')}
          disabled={disabled}
        />
        {nativeReader ? <View style={styles.separator} /> : null}
        {nativeReader ? (
          <SwitchRow
            label="Only with headphones or a car"
            accessibilityLabel="Auto-read only with headphones or a car"
            value={headphonesOnly === 'on'}
            onValueChange={(on) => setHeadphonesOnly(on ? 'on' : 'off')}
            disabled={disabled}
          />
        ) : null}
      </View>

      <Text style={[styles.groupHeading, readAloudStyles.groupGap]}>WHAT TO READ</Text>
      <OptionRows
        options={READ_SCOPES}
        selected={readScope}
        onSelect={setReadScope}
        disabled={disabled}
      />

      <Text style={[styles.groupHeading, readAloudStyles.groupGap]}>PROJECT NAME</Text>
      <OptionRows
        options={PROJECT_NAME_MODES}
        selected={projectNameMode}
        onSelect={setProjectNameMode}
        disabled={disabled}
      />

      <Text style={[styles.groupHeading, readAloudStyles.groupGap]}>SOUND BEFORE A MESSAGE</Text>
      <OptionRows
        options={CHIME_MODES}
        selected={chimeMode}
        disabled={disabled}
        onSelect={(mode) => {
          setChimeMode(mode)
          if (mode !== 'off') {
            playChimeSample()
          }
        }}
      />
    </View>
  )
}

/** Orca Voice fork: every read-aloud option in one menu (Settings → Read aloud). */
export default function ReadAloudSettingsScreen() {
  useMobileColorScheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { autoRead, setAutoRead } = useAutoReadRepliesPreference()
  const { builtInPage, setBuiltInPage } = useBuiltInPagePreference()
  const { value: linkReading, setValue: setLinkReading } = useLinkReading()
  const { value: tableReading, setValue: setTableReading } = useTableReading()
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
        <View style={[styles.section, styles.sectionTopGap]}>
          <SwitchRow
            label="Read button"
            sublabel="Shows a Read button below each message."
            value={builtInPage}
            onValueChange={setBuiltInPage}
          />
        </View>

        <ReadAloudVoiceGroup state={speechOptions} onOpenPicker={setPicker} />

        <Text style={[styles.groupHeading, readAloudStyles.groupGap]}>LINKS</Text>
        <Text style={readAloudStyles.groupDescription}>
          Examples for “Here is the source: WHO report”, with a link to who.int.
        </Text>
        <OptionRows
          options={LINK_READINGS}
          selected={linkReading}
          onSelect={(mode) => {
            setLinkReading(mode)
            speakLinkSample(mode)
          }}
        />

        <Text style={[styles.groupHeading, readAloudStyles.groupGap]}>TABLES</Text>
        <Text style={readAloudStyles.groupDescription}>
          Examples for a table with the columns Day and Run.
        </Text>
        <OptionRows
          options={TABLE_READINGS}
          selected={tableReading}
          onSelect={(mode) => {
            setTableReading(mode)
            speakTableSample(mode)
          }}
        />

        <Text style={[styles.groupHeading, readAloudStyles.groupGap]}>AUTO-READ</Text>
        <Text style={readAloudStyles.groupDescription}>
          Reads new messages from all agents when they arrive.
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <SwitchRow label="Auto-read new messages" value={autoRead} onValueChange={setAutoRead} />
        </View>
        <AutoReadOptions enabled={autoRead} />
      </ScrollView>

      <ReadAloudVoicePickers
        state={speechOptions}
        picker={picker}
        onClose={() => setPicker(null)}
      />
    </View>
  )
}
