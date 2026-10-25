import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))

const { PROJECT_NAME_REPEAT_AFTER_MS, projectNameIntro, spokenProjectName } =
  await import('./project-name-announcement')

describe('spokenProjectName', () => {
  it('splits joined words so the voice reads them apart', () => {
    expect(spokenProjectName('OrcaVoice')).toBe('Orca Voice')
    expect(spokenProjectName('OnTheRoad')).toBe('On The Road')
    expect(spokenProjectName('HTMLParser')).toBe('HTML Parser')
    expect(spokenProjectName('on-the_road')).toBe('on the road')
    expect(spokenProjectName('Ksiegowosc')).toBe('Ksiegowosc')
  })
})

describe('projectNameIntro', () => {
  const now = 1_000_000

  it('names every message, or none, or only a change of project', () => {
    const last = { project: 'SmartHome', at: now - 1_000 }
    expect(projectNameIntro('every', 'SmartHome', last, now)).toBe('Smart Home')
    expect(projectNameIntro('off', 'OrcaVoice', last, now)).toBeNull()
    expect(projectNameIntro('on-change', 'SmartHome', last, now)).toBeNull()
    expect(projectNameIntro('on-change', 'OrcaVoice', last, now)).toBe('Orca Voice')
    expect(projectNameIntro('on-change', 'OrcaVoice', null, now)).toBe('Orca Voice')
  })

  it('names the same project again after a quiet spell', () => {
    const last = { project: 'SmartHome', at: now - PROJECT_NAME_REPEAT_AFTER_MS }
    expect(projectNameIntro('on-change', 'SmartHome', last, now)).toBe('Smart Home')
  })

  it('says nothing for a message whose project is unknown', () => {
    expect(projectNameIntro('every', null, null, now)).toBeNull()
  })
})
