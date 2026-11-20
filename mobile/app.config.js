// Bare expo-notifications defaults to sandbox entitlements while non-dev push-token.ts reports production, silently losing TestFlight/App Store pushes.
// Derive APNs mode from release workflow env; Expo still supplies app.json, including Fastlane version/buildNumber rewrites, for everything else.
const APS_ENVIRONMENT =
  process.env.ORCA_IOS_APS_ENVIRONMENT === 'production' ? 'production' : 'development'

module.exports = ({ config }) => ({
  ...config,
  // Orca Voice fork: build number set by voice/build-apk.ps1, shown in About and Chat UI settings.
  extra: { ...config.extra, voiceBuild: process.env.ORCA_VOICE_BUILD ?? null },
  // `expo run` installs a dev-client build cached for the current native fingerprint instead of
  // rebuilding; scripts/native-client.mjs populates the cache.
  buildCacheProvider: { plugin: './scripts/native-build-cache.cjs' },
  // Orca Voice fork: upstream moved Android to dev.orca.app; the phone has this app as
  // com.stably.orca.mobile, so an update must keep that package and its name.
  android: { ...config.android, package: 'com.stably.orca.mobile' },
  ios: {
    ...config.ios,
    entitlements: { ...config.ios?.entitlements, 'aps-environment': APS_ENVIRONMENT }
  },
  plugins: (config.plugins ?? [])
    .filter((plugin) => plugin !== './plugins/android-retired-app-name.js')
    .map((plugin) =>
    plugin === 'expo-notifications'
      ? [
          'expo-notifications',
          {
            enableBackgroundRemoteNotifications: true,
            mode: APS_ENVIRONMENT,
            icon: './assets/notification-icon.png'
          }
        ]
      : plugin
  )
})
