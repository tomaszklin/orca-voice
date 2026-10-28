import { useEffect } from 'react'
import { useHeadphonesOnly, useLinkReading } from './reading-preferences'
import {
  nextMessage,
  pauseReading,
  previousMessage,
  repeatLast,
  resumeReading,
  setAutoReadNeedsHeadphones,
  stopSpeaking
} from './reply-speaker'
import { setLinkReading } from './speech-text'
import { voiceNativeModule, type ReaderControl } from './voice-native-module'

function handleControl(action: ReaderControl): void {
  switch (action) {
    case 'pause':
      pauseReading('pause button')
      return
    case 'play':
      resumeReading('play button')
      return
    case 'next':
      nextMessage('next button')
      return
    case 'previous':
      previousMessage('previous button')
      return
    case 'repeat':
      repeatLast('repeat button')
      return
    case 'stop':
      stopSpeaking('stop button')
  }
}

/**
 * Orca Voice fork: mounted once with the reader overlay. Hands the reading notification's and the
 * headset's buttons (owner's request, 2026-10-28) to the reader whatever screen is open, and keeps
 * the reader in line with the link and headphones options.
 */
export function useReaderControls(): void {
  const links = useLinkReading().value
  const headphonesOnly = useHeadphonesOnly().value
  useEffect(() => setLinkReading(links), [links])
  useEffect(() => setAutoReadNeedsHeadphones(headphonesOnly === 'on'), [headphonesOnly])
  useEffect(() => {
    const subscription = voiceNativeModule()?.addListener('onReaderControl', ({ action }) =>
      handleControl(action)
    )
    return () => subscription?.remove()
  }, [])
}
