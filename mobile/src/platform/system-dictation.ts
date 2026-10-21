import { useMemo } from 'react'
import { recognizeWithSystemDictation, systemDictationAvailable } from '../speech/system-dictation'

/** Orca Voice fork: the chat mic, answered by the phone's own speech recognition. */
export type SystemDictation = {
  /** False where the phone cannot, so the chat keeps Orca's own dictation. */
  available: boolean
  listen: () => Promise<string | null>
}

/** Native side: the shell's module, directly. The page sibling goes through the bridge. */
export function useSystemDictation(): SystemDictation {
  return useMemo(
    () => ({ available: systemDictationAvailable(), listen: recognizeWithSystemDictation }),
    []
  )
}
