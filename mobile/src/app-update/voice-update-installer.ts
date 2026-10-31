import type { UpdateDownloadEvent, VoiceNativeModule } from '../speech/voice-native-module'

export type VoiceUpdateStatus =
  | { phase: 'idle' }
  /** Waiting for the user to allow Orca to install apps, in the system screen. */
  | { phase: 'allow'; url: string }
  | { phase: 'downloading'; url: string; percent: number }
  /** On the phone; the installer is open or opens next, and can be reopened if it was dismissed. */
  | { phase: 'ready'; url: string }
  | { phase: 'failed'; url: string; message: string }

const IDLE: VoiceUpdateStatus = { phase: 'idle' }

type UpdateNative = Pick<
  VoiceNativeModule,
  'installUpdate' | 'openUpdateInstaller' | 'canInstallUpdates' | 'openInstallPermission'
> & {
  addListener(
    event: 'onUpdateDownload',
    listener: (payload: UpdateDownloadEvent) => void
  ): { remove(): void }
}

export type VoiceUpdateInstallerDeps = {
  native: () => UpdateNative | null
  isForeground: () => boolean
  subscribeForeground: (onForeground: () => void) => void
  openInBrowser: (url: string) => void
}

/**
 * Orca Voice fork: the in-app update, from the tap to the system installer. Android refuses to
 * open an activity for a background app, so a download that ends with Orca left waits for its
 * return (the notification can open the installer meanwhile).
 */
export function createVoiceUpdateInstaller(deps: VoiceUpdateInstallerDeps) {
  let status = IDLE
  let wired = false
  let installerDue = false
  const listeners = new Set<() => void>()

  function publish(next: VoiceUpdateStatus): void {
    status = next
    for (const listener of listeners) {
      listener()
    }
  }

  function openInstaller(native: UpdateNative, url: string): void {
    if (deps.isForeground()) {
      installerDue = false
      if (!native.openUpdateInstaller()) {
        publish({ phase: 'failed', url, message: "Couldn't open the installer" })
      }
    } else {
      installerDue = true
    }
  }

  function wire(native: UpdateNative): void {
    if (wired) {
      return
    }
    wired = true
    native.addListener('onUpdateDownload', ({ event, percent, message }) => {
      if (status.phase !== 'downloading') {
        return
      }
      const { url } = status
      if (event === 'progress') {
        publish({ phase: 'downloading', url, percent: percent ?? 0 })
      } else if (event === 'failed') {
        publish({ phase: 'failed', url, message: message ?? "Couldn't download the update" })
      } else {
        publish({ phase: 'ready', url })
        openInstaller(native, url)
      }
    })
    deps.subscribeForeground(() => {
      if (status.phase === 'allow' && native.canInstallUpdates()) {
        install(status.url)
      } else if (status.phase === 'ready' && installerDue) {
        openInstaller(native, status.url)
      }
    })
  }

  /** Why the guard: a second tap used to reach the browser while the first still downloaded. */
  function install(url: string): void {
    const native = deps.native()
    if (native === null) {
      deps.openInBrowser(url)
      return
    }
    wire(native)
    if (status.phase === 'downloading') {
      return
    }
    if (status.phase === 'ready' && status.url === url) {
      openInstaller(native, url)
      return
    }
    // Checked before the download: 60 MB is a long way to go to learn the installer is not allowed.
    if (!native.canInstallUpdates() && native.openInstallPermission()) {
      publish({ phase: 'allow', url })
      return
    }
    publish(
      native.installUpdate(url)
        ? { phase: 'downloading', url, percent: 0 }
        : { phase: 'failed', url, message: "Couldn't start the download" }
    )
  }

  return {
    install,
    /** Hides a finished or failed update; a download in progress has nothing to dismiss. */
    dismiss(): void {
      if (status.phase !== 'downloading') {
        installerDue = false
        publish(IDLE)
      }
    },
    getStatus: (): VoiceUpdateStatus => status,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}
