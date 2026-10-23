import type { PickerOption } from '../components/PickerModal'
import type { NativeVoiceList } from './voice-native-module'

/** Picker value for "whatever the phone's text-to-speech settings say", for speed and voice. */
export const PHONE_SETTING = 'phone-setting'

const RATES = [0.8, 1, 1.2, 1.4, 1.6, 1.8, 2]

function rateLabel(rate: number): string {
  return rate === 1 ? 'Normal (1×)' : `${rate}×`
}

export const SPEED_OPTIONS: PickerOption[] = [
  {
    value: PHONE_SETTING,
    label: 'Phone setting',
    subtitle: "The speed in the phone's text-to-speech settings"
  },
  ...RATES.map((rate) => ({ value: String(rate), label: rateLabel(rate) }))
]

/** The picker value nearest to a stored rate. */
export function speedValue(rate: number | null): string {
  if (rate === null) {
    return PHONE_SETTING
  }
  const nearest = RATES.reduce((best, r) => (Math.abs(r - rate) < Math.abs(best - rate) ? r : best))
  return String(nearest)
}

export function rateFromSpeedValue(value: string): number | null {
  return value === PHONE_SETTING ? null : Number(value)
}

export function describeSpeed(rate: number | null): string {
  return rate === null ? 'Phone setting' : rateLabel(rate)
}

function primaryLanguage(tag: string): string {
  return (tag.split(/[-_]/)[0] ?? '').toLowerCase()
}

// Why: Google's voices come in pairs that differ only by this suffix — one on the phone, one
// online — so a pair shares a number and the user hears it as one voice.
function variantOf(name: string): string {
  return name.replace(/-(local|network)$/i, '')
}

export type VoiceChoice = { name: string; label: string; detail: string }

/**
 * Installed voices in the language the engine reads in, plus the chosen one, numbered by
 * variant. Engine names (`pl-pl-x-oda-local`) mean nothing to a listener, so they are numbered.
 */
export function voiceChoices(list: NativeVoiceList, chosen: string | null): VoiceChoice[] {
  const language = primaryLanguage(list.language)
  const voices = list.voices
    .filter(
      (voice) =>
        voice.name === chosen || (voice.installed && primaryLanguage(voice.language) === language)
    )
    .sort((a, b) => a.name.localeCompare(b.name))
  const variants = [...new Set(voices.map((voice) => variantOf(voice.name)))]
  return voices.map((voice) => ({
    name: voice.name,
    label: `Voice ${variants.indexOf(variantOf(voice.name)) + 1}`,
    detail: [
      voice.needsInternet ? 'Needs internet' : 'Offline',
      voice.name === list.defaultVoice ? 'phone default' : null
    ]
      .filter((part) => part !== null)
      .join(' · ')
  }))
}

export function voicePickerOptions(choices: VoiceChoice[]): PickerOption[] {
  return [
    {
      value: PHONE_SETTING,
      label: 'Phone setting',
      subtitle: "The voice in the phone's text-to-speech settings"
    },
    ...choices.map((choice) => ({
      value: choice.name,
      label: choice.label,
      subtitle: choice.detail
    }))
  ]
}

export function describeVoice(chosen: string | null, choices: VoiceChoice[]): string {
  if (chosen === null) {
    return 'Phone setting'
  }
  const choice = choices.find((c) => c.name === chosen)
  return choice ? `${choice.label} · ${choice.detail}` : chosen
}
