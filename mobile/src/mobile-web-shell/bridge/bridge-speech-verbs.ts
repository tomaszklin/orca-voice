import { z } from 'zod'
import { BRIDGE_MAX_MESSAGE_BYTES } from './bridge-caps'

/**
 * Orca Voice fork: the page asks the shell to read a reply aloud with the phone's TTS.
 *
 * One verb with an action, because a verb is a grant and the session route has few to spare.
 * Only `speak`: the reader overlay's Stop pill ends a reading on any screen.
 *
 * The text is the reply's markdown; the shell turns it into speech text itself, so the page never
 * has to agree with the shell on what is worth hearing. JSON can spend 6 bytes on one character
 * (\u0001), so the cap keeps a full request under the bridge frame bound.
 */
export const SPEECH_MAX_MARKDOWN_CHARS = Math.floor(BRIDGE_MAX_MESSAGE_BYTES / 8)

export const speechControlParamsSchema = z.strictObject({
  action: z.literal('speak'),
  id: z.string().min(1).max(512),
  markdown: z.string().min(1).max(SPEECH_MAX_MARKDOWN_CHARS)
})

export const speechControlResultSchema = z.strictObject({ accepted: z.boolean() })
