/**
 * Orca Voice fork: whether the background reader's service is running right now.
 *
 * Its own module, free of React Native and storage imports, because the transport reads it
 * (`host-logical-client.ts` keeps the link foreground while it is true).
 */
let active = false
const listeners = new Set<() => void>()

export function backgroundReadingActive(): boolean {
  return active
}

export function subscribeBackgroundReading(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setBackgroundReadingActive(next: boolean): void {
  if (active === next) {
    return
  }
  active = next
  for (const listener of listeners) {
    listener()
  }
}
