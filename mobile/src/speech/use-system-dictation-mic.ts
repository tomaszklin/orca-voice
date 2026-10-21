import { useCallback, useEffect, useRef, useState } from 'react'
import { useSystemDictation } from '../platform/system-dictation'

export type SystemDictationMic = { onPress: () => void; listening: boolean }

/** The draft with what was heard added after it, one space between. */
export function appendDictatedText(draft: string, heard: string): string {
  const words = heard.trim()
  if (!words) {
    return draft
  }
  return draft.length === 0 || /\s$/.test(draft) ? `${draft}${words}` : `${draft} ${words}`
}

/**
 * Orca Voice fork: the chat's mic opens the phone's own dictation and adds what it heard to the
 * draft (owner's choice, 2026-10-21). Orca's dictation needs a speech model on the desktop, and
 * without one the mic opened its setup sheet. Null where the phone cannot, keeping Orca's.
 */
export function useSystemDictationMic(
  text: string,
  setText: (next: string) => void
): SystemDictationMic | null {
  const dictation = useSystemDictation()
  const [listening, setListening] = useState(false)
  // The draft as it is when the dialog answers, not as it was when the mic was pressed.
  const textRef = useRef(text)
  useEffect(() => {
    textRef.current = text
  }, [text])
  const onPress = useCallback(() => {
    if (listening) {
      return
    }
    setListening(true)
    void dictation.listen().then((heard) => {
      setListening(false)
      if (heard?.trim()) {
        setText(appendDictatedText(textRef.current, heard))
      }
    })
  }, [dictation, listening, setText])
  return dictation.available ? { onPress, listening } : null
}
