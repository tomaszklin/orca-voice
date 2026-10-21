import { describe, expect, it } from 'vitest'
import {
  createVoiceBuildUpdateSource,
  isNewerVoiceBuild,
  isVoiceUpdateUrl,
  VOICE_UPDATE_BASES
} from './voice-build-update-source'

const index = {
  build: 15,
  version: '0.0.57',
  file: 'orca-voice-0.0.57-b15.apk',
  date: '2026-10-21'
}

function fetchAnswering(answers: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const body = answers[String(input)]
    if (body === undefined) {
      throw new Error('unreachable')
    }
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

describe('voice build updates', () => {
  it('offers a newer build from whichever address answers', async () => {
    const away = `${VOICE_UPDATE_BASES[1]}version.json`
    const source = createVoiceBuildUpdateSource(fetchAnswering({ [away]: index }))
    const result = await source.check('build 14', new AbortController().signal)
    expect(result).toEqual({
      kind: 'available',
      version: 'build 15',
      url: `${VOICE_UPDATE_BASES[1]}orca-voice-0.0.57-b15.apk`
    })
    expect(result.kind === 'available' && isVoiceUpdateUrl(result.url)).toBe(true)
  })

  it('is current on the same build and fails when no address answers', async () => {
    const home = `${VOICE_UPDATE_BASES[0]}version.json`
    const source = createVoiceBuildUpdateSource(fetchAnswering({ [home]: index }))
    await expect(source.check('build 15', new AbortController().signal)).resolves.toEqual({
      kind: 'current'
    })
    const offline = createVoiceBuildUpdateSource(fetchAnswering({}))
    await expect(offline.check('build 15', new AbortController().signal)).rejects.toThrow()
  })

  it('compares build numbers, not semver', () => {
    expect(isNewerVoiceBuild('build 10', 'build 9')).toBe(true)
    expect(isNewerVoiceBuild('build 9', 'build 10')).toBe(false)
    expect(isNewerVoiceBuild('0.0.58', 'build 9')).toBe(false)
    expect(isVoiceUpdateUrl('https://github.com/stablyai/orca/releases/tag/x')).toBe(false)
  })
})
