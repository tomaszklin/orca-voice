import { useCallback } from 'react'
import {
  AUTO_READ_REPLIES_KEY,
  DEFAULT_AUTO_READ_REPLIES,
  type StoredFlag
} from '../storage/speech-preferences'
import { stopSpeaking } from './reply-speaker'
import { createStoredChoice } from './stored-choice'

// One per-device value shared by Settings (writer) and the host list (reader), so a toggle
// takes effect on the list without a remount.
const useAutoReadChoice = createStoredChoice<StoredFlag>(
  AUTO_READ_REPLIES_KEY,
  ['true', 'false'],
  DEFAULT_AUTO_READ_REPLIES
)

export function useAutoReadRepliesPreference(): {
  autoRead: boolean
  setAutoRead: (next: boolean) => void
} {
  const { value, setValue } = useAutoReadChoice()
  const setAutoRead = useCallback(
    (next: boolean) => {
      setValue(next ? 'true' : 'false')
      if (!next) {
        stopSpeaking('auto-read switched off')
      }
    },
    [setValue]
  )
  return { autoRead: value === 'true', setAutoRead }
}
