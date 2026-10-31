import { openExternalLink } from '../platform/external-link'
import type { KnownAppUpdate } from '../storage/app-update-preferences'

// The page bundle must not carry the checker; the wall inside the page keeps the fallback link.
export function useWallAppUpdate(): KnownAppUpdate | null {
  return null
}

export function openWallLink(url: string): void {
  openExternalLink(url)
}
