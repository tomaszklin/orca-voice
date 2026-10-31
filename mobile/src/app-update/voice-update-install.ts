import * as Linking from 'expo-linking'
import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import { voiceNativeModule } from '../speech/voice-native-module'
import { createVoiceUpdateInstaller, type VoiceUpdateStatus } from './voice-update-installer'

export const voiceUpdateInstaller = createVoiceUpdateInstaller({
  native: voiceNativeModule,
  isForeground: () => AppState.currentState === 'active',
  subscribeForeground: (onForeground) => {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        onForeground()
      }
    })
  },
  // Only a build without the module gets here.
  openInBrowser: (url) => {
    void Linking.openURL(url).catch(() => {})
  }
})

export const installVoiceUpdate = voiceUpdateInstaller.install

export function useVoiceUpdateStatus(): VoiceUpdateStatus {
  return useSyncExternalStore(voiceUpdateInstaller.subscribe, voiceUpdateInstaller.getStatus)
}
