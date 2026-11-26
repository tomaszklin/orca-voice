/**
 * Orca Voice fork: whether the background reader's service is running right now.
 *
 * Its own module, free of React Native and storage imports, because the transport reads it
 * (`host-logical-client.ts` keeps the link foreground while it is true).
 */
let active = false
// Orca's Android Auto screen counts too: it reads and replies with the phone in a pocket.
let carSession = false
const listeners = new Set<() => void>()

export function backgroundReadingActive(): boolean {
  return active || carSession
}

export function subscribeBackgroundReading(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function change(apply: () => void): void {
  const before = backgroundReadingActive()
  apply()
  if (before !== backgroundReadingActive()) {
    for (const listener of listeners) {
      listener()
    }
  }
}

export function setBackgroundReadingActive(next: boolean): void {
  change(() => {
    active = next
  })
}

export function setCarSessionActive(next: boolean): void {
  change(() => {
    carSession = next
  })
}
