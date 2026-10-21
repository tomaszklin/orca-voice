import { speechControlParamsSchema } from '../mobile-web-shell/bridge/bridge-speech-verbs'
import { speakReply, stopSpeaking } from '../speech/reply-speaker'

/** The device side of `native.speech.control`: the page's Read button, spoken by the shell's TTS. */
export async function serveNativeSpeechVerb(params: unknown): Promise<{ accepted: boolean }> {
  // The host parsed these against the same schema before dispatching; parsing again types them.
  const call = speechControlParamsSchema.parse(params)
  if (call.action === 'stop') {
    stopSpeaking('page asked to stop')
  } else {
    speakReply(call.id, call.markdown, 'interrupt')
  }
  return { accepted: true }
}
