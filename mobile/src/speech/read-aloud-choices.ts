import type {
  ChimeMode,
  LinkReading,
  ProjectNameMode,
  ReadScope,
  TableReading
} from '../storage/speech-preferences'
import type { Option } from './read-aloud-setting-rows'

// Orca Voice fork: the lists the Read aloud settings pick from.

export const READ_SCOPES: Option<ReadScope>[] = [
  {
    value: 'all',
    label: 'Every message',
    sublabel: 'Also messages the agent writes while it works.'
  },
  {
    value: 'all-on-screen',
    label: 'Every message on screen',
    sublabel: 'With the screen off, only final replies.'
  },
  {
    value: 'replies',
    label: 'Final replies only'
  }
]

export const PROJECT_NAME_MODES: Option<ProjectNameMode>[] = [
  {
    value: 'on-change',
    label: 'When the project changes',
    sublabel: 'Also after two minutes without messages.'
  },
  { value: 'every', label: 'Before every message' },
  { value: 'off', label: 'Off' }
]

export const CHIME_MODES: Option<ChimeMode>[] = [
  { value: 'every', label: 'Before every message' },
  {
    value: 'on-change',
    label: 'When the project changes',
    sublabel: 'Also after two minutes without messages.'
  },
  { value: 'off', label: 'Off' }
]

// The sublabels quote what "Here is the source: [WHO report](https://www.who.int/…)" becomes.
export const LINK_READINGS: Option<LinkReading>[] = [
  {
    value: 'word-and-text',
    label: 'The word “link”, then its text',
    sublabel: '“Here is the source: link WHO report”'
  },
  {
    value: 'word-text-site',
    label: 'The word “link”, its text and the site',
    sublabel: '“Here is the source: link WHO report, who.int”'
  },
  {
    value: 'text',
    label: 'Only its text',
    sublabel: '“Here is the source: WHO report”'
  },
  { value: 'off', label: 'Skip links', sublabel: '“Here is the source”' }
]

export const TABLE_READINGS: Option<TableReading>[] = [
  {
    value: 'with-headers',
    label: 'Row by row, with column names',
    sublabel: '“Day: Tuesday, Run: Intervals. Day: Thursday, Run: Easy run.”'
  },
  {
    value: 'values',
    label: 'Row by row, values only',
    sublabel: '“Day, Run. Tuesday, Intervals.”'
  },
  { value: 'skip', label: 'Skip tables', sublabel: '“Table skipped.”' }
]
