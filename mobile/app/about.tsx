import { Linking, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import AboutScreen from '../src/settings/about-screen'

// Read version and native build id from expo-constants to match app.json: iOS buildNumber and Android versionCode.
function getVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? '?.?.?'
  const build =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber
      : String(Constants.expoConfig?.android?.versionCode ?? '')
  const voiceBuild = Constants.expoConfig?.extra?.voiceBuild
  const label = build ? `v${version} (${build})` : `v${version}`
  return voiceBuild ? `${label} · voice build ${voiceBuild}` : label
}

export default function NativeAboutRoute() {
  const router = useRouter()
  return (
    <AboutScreen
      onBack={() => router.back()}
      openExternal={(url) => Linking.openURL(url)}
      versionLabel={getVersionLabel()}
    />
  )
}
