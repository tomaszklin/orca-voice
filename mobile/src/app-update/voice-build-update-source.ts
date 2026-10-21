import { z } from 'zod'
import type { AppUpdateSource } from './app-update-source'

/**
 * Orca Voice fork: builds update from the home server, the way the owner's HAL 9000 app does
 * (SmartHome `09-aplikacja-hal.md`). Home Assistant serves `/local/orca-voice/` with no login, at
 * home and over ZeroTier only; `voice/publish-apk.ps1` puts each build there, `version.json` last.
 */
export const VOICE_UPDATE_BASES = [
  'http://192.168.0.223/local/orca-voice/',
  'http://172.24.140.251/local/orca-voice/'
]

const indexSchema = z.looseObject({
  build: z.number().int().positive(),
  file: z.string().min(1)
})

/** The checker's version string for a build: "build 15", shown as "Orca build 15 is available". */
export function voiceBuildLabel(build: number | string): string {
  return `build ${build}`
}

function voiceBuildNumber(label: string): number | null {
  const match = /^build (\d+)$/.exec(label)
  return match ? Number(match[1]) : null
}

export function isNewerVoiceBuild(candidate: string, installed: string): boolean {
  const candidateBuild = voiceBuildNumber(candidate)
  const installedBuild = voiceBuildNumber(installed)
  return candidateBuild !== null && installedBuild !== null && candidateBuild > installedBuild
}

/** An update this channel offered: installed inside the app rather than opened in a browser. */
export function isVoiceUpdateUrl(url: string): boolean {
  return VOICE_UPDATE_BASES.some((base) => url.startsWith(base))
}

/** The first request to succeed; rejects only when every one failed. */
function firstFulfilled<T>(attempts: readonly Promise<T>[]): Promise<T> {
  return new Promise((resolve, reject) => {
    let failed = 0
    for (const attempt of attempts) {
      attempt.then(resolve, (error: unknown) => {
        failed += 1
        if (failed === attempts.length) {
          reject(error)
        }
      })
    }
  })
}

export function createVoiceBuildUpdateSource(fetchImpl: typeof fetch): AppUpdateSource {
  return {
    async check(installedVersion, signal) {
      // Both addresses at once: the home one answers in the Wi-Fi, the ZeroTier one away from it.
      const { base, index } = await firstFulfilled(
        VOICE_UPDATE_BASES.map(async (base) => {
          const reply = await fetchImpl(`${base}version.json`, {
            signal,
            headers: { 'Cache-Control': 'no-cache' }
          })
          if (!reply.ok) {
            throw new Error(`version.json HTTP ${reply.status}`)
          }
          return { base, index: indexSchema.parse(await reply.json()) }
        })
      )
      const version = voiceBuildLabel(index.build)
      return isNewerVoiceBuild(version, installedVersion)
        ? { kind: 'available', version, url: `${base}${encodeURIComponent(index.file)}` }
        : { kind: 'current' }
    }
  }
}

export const voiceBuildUpdateSource = createVoiceBuildUpdateSource((input, init) =>
  fetch(input, init)
)
