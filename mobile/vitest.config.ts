import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const vitestOxcConfig = { tsconfig: false } as never

export default defineConfig({
  root: import.meta.dirname,
  // Why: the app tsconfig intentionally excludes tests; Vite 8's OXC transform
  // otherwise fails before Vitest can run the test modules.
  oxc: vitestOxcConfig,
  resolve: {
    // Orca Voice fork: a silent Node stand-in for the native TTS module.
    alias: {
      'expo-speech': fileURLToPath(
        new URL('./src/test-support/expo-speech-node.ts', import.meta.url)
      )
    }
  },
  test: {
    pool: 'threads',
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    onConsoleLog: (log) => !log.includes('react-test-renderer is deprecated'),
    // .tsx too: component tests exist (react-test-renderer + mocked react-native) and were
    // silently never collected, so render-level regressions shipped untested.
    // scripts/ too: the CI scripts under it (rpc:diff, the tests-typecheck ratchet) need a runnable
    // test home, and a test vitest never collects is not a gate.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts']
  }
})
