import { View } from 'react-native'
import type { NativeChatMessage } from '../../../../../src/shared/native-chat/native-chat-types'
import { nativeChatMessageCopyText } from '../../../../../src/shared/native-chat/transcript/native-chat-message-copy-text'
import { MobileReplyReadButton } from '../../../components/MobileReplyReadButton'
import { MobileNativeChatMessageTime } from './MobileNativeChatMessageTime'
import { MobileNativeChatRewindButton } from './MobileNativeChatRewindButton'
import { MobileNativeChatResponseActions } from './MobileNativeChatResponseActions'
import { mobileNativeChatRowHoldsForkSlot } from '../use-mobile-native-chat-fork'
import { styles } from './mobile-native-chat-message-styles'

/** A chat turn's time, then its actions together: copy, and rewind on a user row the chat can rewind to. */
export function MobileNativeChatMessageMeta({
  message,
  fontScale,
  rewindable,
  streaming = false
}: {
  message: NativeChatMessage
  fontScale: number
  rewindable?: true
  /** Orca Voice fork: the reply is still being written. */
  streaming?: boolean
}): React.JSX.Element {
  const copyText = nativeChatMessageCopyText(message)
  return (
    <View style={styles.meta}>
      <MobileNativeChatMessageTime timestamp={message.timestamp} fontScale={fontScale} />
      {/* An empty wrapper would still pull the time over by the icons' edge margin. */}
      {copyText.length > 0 || rewindable || mobileNativeChatRowHoldsForkSlot(message) ? (
        <View style={styles.metaActions}>
          <MobileNativeChatResponseActions message={message} copyText={copyText} />
          {rewindable ? <MobileNativeChatRewindButton itemId={message.id} /> : null}
          {/* Orca Voice fork: Read aloud. Disabled, not absent, while streaming, so the row stays put. */}
          {message.role === 'assistant' && copyText.length > 0 ? (
            <MobileReplyReadButton
              id={message.id}
              text={copyText}
              fontScale={fontScale}
              disabled={streaming}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
