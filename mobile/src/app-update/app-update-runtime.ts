import Constants from 'expo-constants'
import * as Linking from 'expo-linking'
import { useSyncExternalStore } from 'react'
import { AppState, Platform } from 'react-native'
import { OrcaPlayStorePresence } from '../../modules/orca-play-store-presence/src'
import {
  loadAppUpdatePreferences,
  saveAppUpdateCheck,
  saveDismissedAppUpdateVersion
} from '../storage/app-update-preferences'
import { appStoreUpdateSource } from './app-store-update-source'
import { createAppUpdateChecker, type AppUpdateState } from './app-update-checker'
import type { AppUpdateSource } from './app-update-source'
import {
  ANDROID_RELEASE_TAG_PREFIX,
  createGithubReleaseUpdateSource,
  RETIRED_ANDROID_RELEASE_TAG_PREFIX
} from './github-release-update-source'
import {
  isNewerVoiceBuild,
  isVoiceUpdateUrl,
  VOICE_UPDATE_CHECK_INTERVAL_MS,
  voiceBuildLabel,
  voiceBuildUpdateSource
} from './voice-build-update-source'
import { installVoiceUpdate } from './voice-update-install'

// expoConfig is embedded binary manifest because app does not use expo-updates; SDK 55 removed nativeAppVersion. Revisit version source if adopting OTA updates.
export const installedAppVersion: string | null = Constants.expoConfig?.version ?? null

// Orca Voice fork: a build that carries its build number updates from the home server instead.
const extraVoiceBuild: unknown = Constants.expoConfig?.extra?.voiceBuild
const voiceBuild = typeof extraVoiceBuild === 'string' && extraVoiceBuild ? extraVoiceBuild : null

/** What Settings shows as the installed version: "0.0.59 (build 45)" on our builds. */
export const installedVersionLabel: string | null =
  voiceBuild && installedAppVersion
    ? `${installedAppVersion} (${voiceBuildLabel(voiceBuild)})`
    : installedAppVersion

// Orca Voice fork: our builds keep the old package but are not the retired app.
/** The GitHub APK's package. Orca moved to Google Play as dev.orca.app, so this app gets no more updates. */
export const isRetiredGithubAndroidApp =
  !voiceBuild &&
  Platform.OS === 'android' &&
  Constants.expoConfig?.android?.package === 'com.stably.orca.mobile'

/** Play delivers this install's updates and forbids other update channels. */
export const isGooglePlayInstall =
  Platform.OS === 'android' && (OrcaPlayStorePresence?.isInstalledByPlayStore() ?? false)

/** The channel that installed this binary. */
function resolveAppUpdateSource(): AppUpdateSource | null {
  if (Platform.OS === 'android') {
    if (voiceBuild) {
      return voiceBuildUpdateSource
    }
    if (isGooglePlayInstall) {
      return null
    }
    return createGithubReleaseUpdateSource(
      (input, init) => fetch(input, init),
      isRetiredGithubAndroidApp ? RETIRED_ANDROID_RELEASE_TAG_PREFIX : ANDROID_RELEASE_TAG_PREFIX
    )
  }
  if (Platform.OS === 'ios') {
    return appStoreUpdateSource
  }
  return null
}

const appUpdateSource = resolveAppUpdateSource()

/** False where no channel can be asked, so there is nothing to check by hand. */
export const canCheckForAppUpdates = appUpdateSource !== null

export const appUpdateChecker = createAppUpdateChecker({
  source: appUpdateSource,
  installedVersion: voiceBuild ? voiceBuildLabel(voiceBuild) : installedAppVersion,
  ...(voiceBuild
    ? { isNewer: isNewerVoiceBuild, checkIntervalMs: VOICE_UPDATE_CHECK_INTERVAL_MS }
    : {}),
  now: () => Date.now(),
  setTimer: (run, delayMs) => setTimeout(run, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
  subscribeForeground: (onForeground) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        onForeground()
      }
    })
    return () => subscription.remove()
  },
  loadPreferences: loadAppUpdatePreferences,
  saveCheck: saveAppUpdateCheck,
  saveDismissedVersion: saveDismissedAppUpdateVersion
})

export function useAppUpdateState(): AppUpdateState {
  return useSyncExternalStore(appUpdateChecker.subscribe, appUpdateChecker.getSnapshot)
}

/** Opens the update the check found: the GitHub release (Android) or App Store (iOS). */
export function openAppUpdate(url: string): void {
  if (isVoiceUpdateUrl(url)) {
    installVoiceUpdate(url)
    return
  }
  void Linking.openURL(url).catch(() => {})
}
