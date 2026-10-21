import { z } from 'zod'

/**
 * Orca Voice fork: the page asks the shell to read a reply aloud with the phone's TTS, or to
 * take dictation with the phone's own speech recognition.
 *
 * One verb with an action rather than a speak/stop pair, because the session route already holds
 * fourteen of its sixteen grants and a verb is a grant.
 *
 * The text is the reply's markdown; the shell turns it into speech text itself, so the page never
 * has to agree with the shell on what is worth hearing. Capped well above any reply the desktop
 * sends (its own cap is 8000 characters) and well below the bridge frame bound.
 */
export const SPEECH_MAX_TEXT_CHARS = 200_000

export const speechControlParamsSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('speak'),
    id: z.string().min(1).max(512),
    markdown: z.string().min(1).max(SPEECH_MAX_TEXT_CHARS)
  }),
  z.strictObject({ action: z.literal('stop') }),
  // The chat's mic: the phone's own dictation, answered with the recognised text.
  z.strictObject({ action: z.literal('listen') })
])

export const speechControlResultSchema = z.strictObject({
  accepted: z.boolean(),
  text: z.string().max(SPEECH_MAX_TEXT_CHARS).optional()
})

export type SpeechControlParams = z.infer<typeof speechControlParamsSchema>
