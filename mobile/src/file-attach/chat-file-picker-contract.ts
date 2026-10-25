/** Orca Voice fork: picking any file for the chat, on whichever half of the app is running. */

export type PickedChatFile = {
  /** Raw base64, no data: prefix. */
  readonly base64: string
  readonly mime: string
  /** Absent on the page: the shell's media verbs do not carry a file name. */
  readonly name?: string
}

/** Resolves null when the user cancelled the picker. */
export type ChatFilePicker = () => Promise<PickedChatFile | null>

/** Over what the host's upload accepts (18 MiB raw). */
export class ChatFileTooLargeError extends Error {
  constructor() {
    super('File is too large to attach')
    this.name = 'ChatFileTooLargeError'
  }
}
