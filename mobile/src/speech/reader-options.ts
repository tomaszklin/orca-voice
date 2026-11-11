/** Orca Voice fork: the reader's options from the Read aloud settings, kept apart from its queue. */

let headphonesOnly = false

/** Auto-read only through headphones or a car. */
export function setAutoReadNeedsHeadphones(on: boolean): void {
  headphonesOnly = on
}

export function autoReadNeedsHeadphones(): boolean {
  return headphonesOnly
}
