import { useMemo } from 'react'
import { speechControlResultSchema } from '../mobile-web-shell/bridge/bridge-speech-verbs'
import { usePageBridgeClient } from '../transport/client-context.web'
import type { SystemDictation } from './system-dictation'

const SPEECH_VERB = 'native.speech.control' as const

/**
 * Page sibling: the shell opens the dictation, over the same verb that reads replies aloud. Only a
 * shell that granted it answers; elsewhere the chat keeps Orca's own dictation.
 */
export function useSystemDictation(): SystemDictation {
  const client = usePageBridgeClient()
  return useMemo(() => {
    const available = client.getShellSession()?.grants.native.includes(SPEECH_VERB) === true
    return {
      available,
      listen: async () => {
        if (!available) {
          return null
        }
        try {
          const reply = await client.callNativeVerb(SPEECH_VERB, { action: 'listen' })
          const parsed = speechControlResultSchema.safeParse(reply.result)
          return parsed.success ? (parsed.data.text ?? null) : null
        } catch {
          return null
        }
      }
    }
  }, [client])
}
