import { useEffect } from 'react'
import {
  useHeadphonesOnly,
  useLanguageVoices,
  useLinkReading,
  useTableReading
} from './reading-preferences'
import {
  nextMessage,
  pauseReading,
  playReading,
  previousMessage,
  stopReading
} from './reply-speaker'
import { setAutoReadNeedsHeadphones } from './reader-options'
import { setLanguageVoices } from './language-segments'
import { setLinkReading, setTableReading } from './speech-text'
import { voiceNativeModule, type ReaderControl } from './voice-native-module'

// `from`: the app that pressed it (Android Auto, a watch), so the reader's log tells them apart.
function handleControl(action: ReaderControl, from: string | null): void {
  const by = (button: string) => (from ? `${button} (${from})` : button)
  switch (action) {
    case 'pause':
      pauseReading(by('pause button'))
      return
    case 'play':
      playReading(by('play button'))
      return
    case 'next':
      nextMessage(by('next button'))
      return
    case 'previous':
      previousMessage(by('previous button'))
      return
    case 'stop':
      stopReading(by('stop button'))
  }
}

/**
 * Orca Voice fork: mounted once with the reader overlay. Hands the reading notification's and the
 * headset's buttons (owner's request, 2026-10-28) to the reader whatever screen is open, and keeps
 * the reader in line with the link, table, headphones and language options.
 */
export function useReaderControls(): void {
  const links = useLinkReading().value
  const tables = useTableReading().value
  const headphonesOnly = useHeadphonesOnly().value
  const languageVoices = useLanguageVoices().value
  useEffect(() => setLinkReading(links), [links])
  useEffect(() => setTableReading(tables), [tables])
  useEffect(() => setAutoReadNeedsHeadphones(headphonesOnly === 'on'), [headphonesOnly])
  useEffect(() => setLanguageVoices(languageVoices === 'on'), [languageVoices])
  useEffect(() => {
    const subscription = voiceNativeModule()?.addListener('onReaderControl', ({ action, from }) =>
      handleControl(action, from ?? null)
    )
    return () => subscription?.remove()
  }, [])
}
