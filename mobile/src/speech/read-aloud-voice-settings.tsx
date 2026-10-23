import { useMemo } from 'react'
import { View, Text, Pressable } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { colors } from '../theme/mobile-theme'
import { PickerModal } from '../components/PickerModal'
import { readAloudStyles as styles } from './read-aloud-settings-styles'
import { speakVoiceSample, useSpeechOptions } from './speech-options'
import {
  PHONE_SETTING,
  SPEED_OPTIONS,
  describeSpeed,
  describeVoice,
  rateFromSpeedValue,
  speedValue,
  voiceChoices,
  voicePickerOptions
} from './voice-choice'

export type VoicePicker = 'speed' | 'voice'

type SpeechOptionsState = ReturnType<typeof useSpeechOptions>

function useVoiceChoices(state: SpeechOptionsState) {
  const { voices, options } = state
  return useMemo(() => (voices ? voiceChoices(voices, options.voice) : []), [voices, options.voice])
}

function ValueRow({
  label,
  value,
  divider,
  onPress
}: {
  label: string
  value: string
  divider: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      style={divider ? [styles.row, styles.rowDivider] : styles.row}
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

/** Orca Voice fork: reading speed and voice, for the Read button and auto-read alike. */
export function ReadAloudVoiceGroup({
  state,
  onOpenPicker
}: {
  state: SpeechOptionsState
  onOpenPicker: (picker: VoicePicker) => void
}) {
  const choices = useVoiceChoices(state)
  return (
    <>
      <Text style={[styles.groupHeading, styles.groupGap]}>VOICE</Text>
      <Text style={styles.groupDescription}>
        Applies to the Read button and auto-read. Picking one reads a short sample.
      </Text>
      <View style={[styles.section, styles.sectionTopGap]}>
        {state.available ? (
          <>
            <ValueRow
              label="Speed"
              value={describeSpeed(state.options.rate)}
              divider={false}
              onPress={() => onOpenPicker('speed')}
            />
            <ValueRow
              label="Voice"
              value={describeVoice(state.options.voice, choices)}
              divider
              onPress={() => onOpenPicker('voice')}
            />
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          style={state.available ? [styles.row, styles.rowDivider] : styles.row}
          onPress={speakVoiceSample}
        >
          <Text style={styles.rowLabel}>Test voice</Text>
        </Pressable>
        {state.available ? (
          <ValueRow
            label="Phone text-to-speech settings"
            value="More voices to download, another speech engine"
            divider
            onPress={state.openPhoneSettings}
          />
        ) : null}
      </View>
    </>
  )
}

/** Rendered at the screen's root, outside the scroll view, so the drawers are not clipped. */
export function ReadAloudVoicePickers({
  state,
  picker,
  onClose
}: {
  state: SpeechOptionsState
  picker: VoicePicker | null
  onClose: () => void
}) {
  const choices = useVoiceChoices(state)
  const { options, setOptions } = state
  return (
    <>
      <PickerModal
        visible={picker === 'speed'}
        title="Reading speed"
        options={SPEED_OPTIONS}
        selected={speedValue(options.rate)}
        onSelect={(value) => setOptions({ ...options, rate: rateFromSpeedValue(value) })}
        onClose={onClose}
      />
      <PickerModal
        visible={picker === 'voice'}
        title="Voice"
        subtitle={
          state.voices === undefined
            ? 'Loading the voices…'
            : state.voices === null
              ? 'The phone did not list its voices'
              : "Installed voices in the phone's reading language"
        }
        options={voicePickerOptions(choices)}
        selected={options.voice ?? PHONE_SETTING}
        onSelect={(value) =>
          setOptions({ ...options, voice: value === PHONE_SETTING ? null : value })
        }
        onClose={onClose}
      />
    </>
  )
}
