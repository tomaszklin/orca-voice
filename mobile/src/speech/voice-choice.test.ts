import { describe, expect, it } from 'vitest'
import {
  PHONE_SETTING,
  describeVoice,
  rateFromSpeedValue,
  speedValue,
  voiceChoices,
  voicePickerOptions
} from './voice-choice'
import type { NativeVoice, NativeVoiceList } from './voice-native-module'

function voice(name: string, language: string, extra: Partial<NativeVoice> = {}): NativeVoice {
  return { name, language, needsInternet: name.endsWith('-network'), installed: true, ...extra }
}

const LIST: NativeVoiceList = {
  language: 'pl-PL',
  defaultVoice: 'pl-pl-x-oda-local',
  voices: [
    voice('pl-pl-x-oda-network', 'pl-PL'),
    voice('en-us-x-iob-local', 'en-US'),
    voice('pl-pl-x-oda-local', 'pl-PL'),
    voice('pl-pl-x-bmg-local', 'pl-PL'),
    voice('pl-pl-x-zfg-local', 'pl-PL', { installed: false })
  ]
}

describe('voiceChoices', () => {
  it('lists installed voices in the reading language, a local/online pair sharing a number', () => {
    expect(voiceChoices(LIST, null)).toEqual([
      { name: 'pl-pl-x-bmg-local', label: 'Voice 1', detail: 'Offline' },
      { name: 'pl-pl-x-oda-local', label: 'Voice 2', detail: 'Offline · phone default' },
      { name: 'pl-pl-x-oda-network', label: 'Voice 2', detail: 'Needs internet' }
    ])
  })

  it('keeps the chosen voice listed even outside the reading language', () => {
    const names = voiceChoices(LIST, 'en-us-x-iob-local').map((choice) => choice.name)
    expect(names).toContain('en-us-x-iob-local')
  })

  it('offers the phone setting first and describes the chosen voice', () => {
    const choices = voiceChoices(LIST, null)
    expect(voicePickerOptions(choices)[0]?.value).toBe(PHONE_SETTING)
    expect(describeVoice('pl-pl-x-oda-network', choices)).toBe('Voice 2 · Needs internet')
    expect(describeVoice(null, choices)).toBe('Phone setting')
  })
})

describe('speed', () => {
  it('maps the phone setting and snaps a stored rate to the nearest option', () => {
    expect(speedValue(null)).toBe(PHONE_SETTING)
    expect(speedValue(1.25)).toBe('1.2')
    expect(rateFromSpeedValue(PHONE_SETTING)).toBeNull()
    expect(rateFromSpeedValue('1.6')).toBe(1.6)
  })
})
