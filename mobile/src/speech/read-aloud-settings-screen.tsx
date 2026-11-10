import { useState } from 'react'
import { View, Text, Pressable, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { PickerModal } from '../components/PickerModal'
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
import { ChoiceRow, SwitchRow, type Option } from './read-aloud-setting-rows'
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

type ChoiceKey = 'links' | 'tables' | 'scope' | 'projectName' | 'chime'

type Choice = {
  label: string
  /** Shown at the top of the drawer, above the options. */
  note?: string
  options: readonly Option<string>[]
  selected: string
  // Method syntax: each choice takes its own narrower value type.
  onSelect(value: string): void
}

function selectedLabel(choice: Choice): string {
  return choice.options.find((option) => option.value === choice.selected)?.label ?? ''
}

/** Orca Voice fork: the list choices of the screen, each picked in a drawer like Terminal → Text size. */
function useChoices(): Record<ChoiceKey, Choice> {
  const { value: linkReading, setValue: setLinkReading } = useLinkReading()
  const { value: tableReading, setValue: setTableReading } = useTableReading()
  const { readScope, setReadScope } = useReadScopePreference()
  const { value: projectNameMode, setValue: setProjectNameMode } = useProjectNameMode()
  const { value: chimeMode, setValue: setChimeMode } = useChimeMode()
  return {
    links: {
      label: 'Links',
      note: 'Examples for “Here is the source: WHO report”, with a link to who.int.',
      options: LINK_READINGS,
      selected: linkReading,
      onSelect: (mode: (typeof LINK_READINGS)[number]['value']) => {
        setLinkReading(mode)
        speakLinkSample(mode)
      }
    },
    tables: {
      label: 'Tables',
      note: 'Examples for a table with the columns Day and Run.',
      options: TABLE_READINGS,
      selected: tableReading,
      onSelect: (mode: (typeof TABLE_READINGS)[number]['value']) => {
        setTableReading(mode)
        speakTableSample(mode)
      }
    },
    scope: {
      label: 'What to read',
      options: READ_SCOPES,
      selected: readScope,
      onSelect: setReadScope
    },
    projectName: {
      label: 'Project name',
      note: 'Said before a message.',
      options: PROJECT_NAME_MODES,
      selected: projectNameMode,
      onSelect: setProjectNameMode
    },
    chime: {
      label: 'Sound before a message',
      options: CHIME_MODES,
      selected: chimeMode,
      onSelect: (mode: (typeof CHIME_MODES)[number]['value']) => {
        setChimeMode(mode)
        if (mode !== 'off') {
          playChimeSample()
        }
      }
    }
  }
}

function ChoiceRows({
  choices,
  keys,
  onOpen,
  disabled = false
}: {
  choices: Record<ChoiceKey, Choice>
  keys: ChoiceKey[]
  onOpen: (key: ChoiceKey) => void
  disabled?: boolean
}) {
  useMobileColorScheme()
  return (
    <View style={[styles.section, styles.sectionTopGap]}>
      {keys.map((key, index) => (
        <View key={key}>
          {index > 0 ? <View style={styles.separator} /> : null}
          <ChoiceRow
            label={choices[key].label}
            value={selectedLabel(choices[key])}
            disabled={disabled}
            onPress={() => onOpen(key)}
          />
        </View>
      ))}
    </View>
  )
}

/** Orca Voice fork: every option of auto-read but the switch itself, greyed out while it is off. */
function AutoReadOptions({
  enabled,
  choices,
  onOpenChoice
}: {
  enabled: boolean
  choices: Record<ChoiceKey, Choice>
  onOpenChoice: (key: ChoiceKey) => void
}) {
  useMobileColorScheme()
  const { backgroundReading, setBackgroundReading } = useBackgroundReadingPreference()
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

      <ChoiceRows
        choices={choices}
        keys={['scope', 'projectName', 'chime']}
        onOpen={onOpenChoice}
        disabled={disabled}
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
  const speechOptions = useSpeechOptions()
  const [picker, setPicker] = useState<VoicePicker | null>(null)
  const choices = useChoices()
  const [openChoice, setOpenChoice] = useState<ChoiceKey | null>(null)
  // Why: the drawer keeps its last choice while it slides away, so its content does not jump.
  const [lastChoice, setLastChoice] = useState<ChoiceKey>('links')
  const openChoiceDrawer = (key: ChoiceKey) => {
    setLastChoice(key)
    setOpenChoice(key)
  }
  const drawerChoice = choices[lastChoice]

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

        <Text style={[styles.groupHeading, readAloudStyles.groupGap]}>LINKS AND TABLES</Text>
        <ChoiceRows choices={choices} keys={['links', 'tables']} onOpen={openChoiceDrawer} />

        <Text style={[styles.groupHeading, readAloudStyles.groupGap]}>AUTO-READ</Text>
        <Text style={readAloudStyles.groupDescription}>
          Reads new messages from all agents when they arrive.
        </Text>
        <View style={[styles.section, styles.sectionTopGap]}>
          <SwitchRow label="Auto-read new messages" value={autoRead} onValueChange={setAutoRead} />
        </View>
        <AutoReadOptions enabled={autoRead} choices={choices} onOpenChoice={openChoiceDrawer} />
      </ScrollView>

      <ReadAloudVoicePickers
        state={speechOptions}
        picker={picker}
        onClose={() => setPicker(null)}
      />
      {/* At the screen's root, outside the scroll view, so the drawer is not clipped. */}
      <PickerModal
        visible={openChoice !== null}
        title={drawerChoice.label}
        subtitle={drawerChoice.note}
        options={drawerChoice.options.map((option) => ({
          value: option.value,
          label: option.label,
          subtitle: option.sublabel
        }))}
        selected={drawerChoice.selected}
        onSelect={(value) => drawerChoice.onSelect(value)}
        onClose={() => setOpenChoice(null)}
      />
    </View>
  )
}
