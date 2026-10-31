import { z } from 'zod'
import type { AppUpdateSource } from './app-update-source'

/**
 * Orca Voice fork: builds update from the fork's GitHub releases (from build 20; the owner's home
 * server before). `latest/download/<name>` redirects to that asset of the newest release, which
 * `voice/publish-github.ps1` gives an APK and a `version.json`.
 */
const VOICE_RELEASES = 'https://github.com/tomaszklin/orca-voice/releases/'
export const VOICE_UPDATE_BASE = `${VOICE_RELEASES}latest/download/`

// Builds come several a day, and Orca stays alive for days with background reading on.
export const VOICE_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

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
  return url.startsWith(VOICE_RELEASES)
}

export function createVoiceBuildUpdateSource(fetchImpl: typeof fetch): AppUpdateSource {
  return {
    async check(installedVersion, signal) {
      const reply = await fetchImpl(`${VOICE_UPDATE_BASE}version.json`, {
        signal,
        headers: { 'Cache-Control': 'no-cache' }
      })
      if (!reply.ok) {
        throw new Error(`version.json HTTP ${reply.status}`)
      }
      const index = indexSchema.parse(await reply.json())
      const version = voiceBuildLabel(index.build)
      return isNewerVoiceBuild(version, installedVersion)
        ? {
            kind: 'available',
            version,
            // Why the tag: under `latest/` this file is a 404 as soon as a newer build is released.
            url: `${VOICE_RELEASES}download/voice-b${index.build}/${encodeURIComponent(index.file)}`
          }
        : { kind: 'current' }
    }
  }
}

export const voiceBuildUpdateSource = createVoiceBuildUpdateSource((input, init) =>
  fetch(input, init)
)
