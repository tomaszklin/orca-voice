import {
  DEFAULT_HEADPHONES_ONLY,
  DEFAULT_LINK_READING,
  HEADPHONES_ONLY_KEY,
  LINK_READING_KEY,
  type HeadphonesOnly,
  type LinkReading
} from '../storage/speech-preferences'
import { createStoredChoice } from './stored-choice'

/** Orca Voice fork: how links are read (owner's request, 2026-10-28), for every reading. */
export const useLinkReading = createStoredChoice<LinkReading>(
  LINK_READING_KEY,
  ['word-and-text', 'text', 'word-text-site', 'off'],
  DEFAULT_LINK_READING
)

/**
 * Orca Voice fork: auto-read only through headphones or a car (owner's request, 2026-10-28), so
 * the phone does not start talking out loud in an office or a shop.
 */
export const useHeadphonesOnly = createStoredChoice<HeadphonesOnly>(
  HEADPHONES_ONLY_KEY,
  ['on', 'off'],
  DEFAULT_HEADPHONES_ONLY
)
