import { useMemo } from 'react'
import { SPEECH_MAX_MARKDOWN_CHARS } from '../mobile-web-shell/bridge/bridge-speech-verbs'
import { useNativeVerbs } from '../mobile-web-shell/bridge/use-native-verbs'
import type { ReplySpeech } from './reply-speech'

/**
 * Page sibling: Android's WebView has no speechSynthesis, so the shell speaks for the page,
 * through the page's native verbs (grant check, result parsing, error codes).
 *
 * Only a shell that granted `native.speech.control` gets a Read button: the official shell and an
 * older Orca Voice build do not serve the verb, and a button that rejects on every tap is worse
 * than none. A very long reply is read from its start rather than refused. Failures are swallowed
 * — a reply that could not be read is not worth a dialog.
 */
export function useReplySpeech(): ReplySpeech {
  const verbs = useNativeVerbs()
  return useMemo(
    () => ({
      canSpeak: verbs.canSpeak,
      speak: (id, markdown) => {
        void verbs.speak(id, markdown.slice(0, SPEECH_MAX_MARKDOWN_CHARS)).catch(() => undefined)
      }
    }),
    [verbs]
  )
}
