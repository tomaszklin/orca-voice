import type { KnownAppUpdate } from '../storage/app-update-preferences'
import { openAppUpdate, useAppUpdateState } from './app-update-runtime'

// Ignore dismissal at update wall; checker’s existing cadence covers it without extra triggers.
export function useWallAppUpdate(): KnownAppUpdate | null {
  return useAppUpdateState().available
}

/** Orca Voice fork: the wall's update installs in the app, like the home card's and Settings'. */
export function openWallLink(url: string): void {
  openAppUpdate(url)
}
