import { isKnownHarnessInjectedUserTurnText } from '../../../src/shared/harness-injected-user-turns'

/**
 * Orca Voice fork: whether each message of a chat feed belongs to a turn the owner started, for
 * the same rule as final replies (`user-turn-guard.ts`): a turn that began with a harness notice
 * (a background task ending) is not the owner's.
 */

type OriginMessage = {
  id: string
  role: string
  blocks: readonly { text?: string }[]
}

function isUserPrompt(message: OriginMessage): boolean {
  const text = message.blocks.flatMap((block) => (block.text ? [block.text] : [])).join('\n')
  return !isKnownHarnessInjectedUserTurnText(text)
}

/**
 * Each non-user message's origin, by id, walking on from `fromUser` (the turn the last frame ended
 * in); `last` is the turn this frame ends in.
 */
export function turnOrigins(
  messages: readonly OriginMessage[],
  fromUser: boolean
): { origins: Map<string, boolean>; last: boolean } {
  const origins = new Map<string, boolean>()
  let turn = fromUser
  for (const message of messages) {
    if (message.role === 'user') {
      turn = isUserPrompt(message)
    } else {
      origins.set(message.id, turn)
    }
  }
  return { origins, last: turn }
}
