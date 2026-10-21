import { speechControlParamsSchema } from '../mobile-web-shell/bridge/bridge-speech-verbs'
import { speakReply, stopSpeaking } from '../speech/reply-speaker'
import { recognizeWithSystemDictation } from '../speech/system-dictation'

/**
 * The device side of `native.speech.control`: the page's Read button, spoken by the shell's TTS,
 * and the chat's mic, answered by the phone's own dictation.
 */
export async function serveNativeSpeechVerb(
  params: unknown
): Promise<{ accepted: boolean; text?: string }> {
  // The host parsed these against the same schema before dispatching; parsing again types them.
  const call = speechControlParamsSchema.parse(params)
  if (call.action === 'listen') {
    const text = await recognizeWithSystemDictation()
    return text ? { accepted: true, text } : { accepted: false }
  }
  if (call.action === 'stop') {
    stopSpeaking('page asked to stop')
  } else {
    speakReply(call.id, call.markdown, 'interrupt')
  }
  return { accepted: true }
}
