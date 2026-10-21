import * as Linking from 'expo-linking'
import { voiceNativeModule } from '../speech/voice-native-module'

/**
 * Orca Voice fork: downloads the build in the app and opens the system installer, with progress
 * in a notification. Without the module, the browser downloads it instead.
 */
export function installVoiceUpdate(url: string): void {
  const native = voiceNativeModule()
  if (native === null || !native.installUpdate(url)) {
    void Linking.openURL(url).catch(() => {})
  }
}
