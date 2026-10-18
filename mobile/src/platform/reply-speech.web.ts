import { useMemo } from 'react'
import { usePageBridgeClient } from '../transport/client-context.web'
import type { ReplySpeech } from './reply-speech'

const SPEECH_VERB = 'native.speech.control' as const

/**
 * Page sibling: Android's WebView has no speechSynthesis, so the shell speaks for the page.
 *
 * Only a shell that granted `native.speech.control` gets a Read button: the official shell and an
 * older Orca Voice build do not serve the verb, and a button that rejects on every tap is worse
 * than none. Failures are swallowed — a reply that could not be read is not worth a dialog.
 */
export function useReplySpeech(): ReplySpeech {
  const client = usePageBridgeClient()
  return useMemo(() => {
    const canSpeak = client.getShellSession()?.grants.native.includes(SPEECH_VERB) === true
    const send = (params: unknown) => {
      if (canSpeak) {
        void client.callNativeVerb(SPEECH_VERB, params).catch(() => undefined)
      }
    }
    return {
      canSpeak,
      speak: (id, markdown) => send({ action: 'speak', id, markdown }),
      stop: () => send({ action: 'stop' })
    }
  }, [client])
}
