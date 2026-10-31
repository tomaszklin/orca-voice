import { describe, expect, it, vi } from 'vitest'
import type { UpdateDownloadEvent } from '../speech/voice-native-module'
import { createVoiceUpdateInstaller } from './voice-update-installer'

const URL_A = 'https://github.com/tomaszklin/orca-voice/releases/download/voice-b44/a.apk'

function harness(opts: { allowed?: boolean; moduleMissing?: boolean } = {}) {
  let emit: (event: UpdateDownloadEvent) => void = () => {}
  let returnToApp: () => void = () => {}
  const state = { foreground: true, allowed: opts.allowed ?? true }
  const native = {
    installUpdate: vi.fn(() => true),
    openUpdateInstaller: vi.fn(() => true),
    canInstallUpdates: vi.fn(() => state.allowed),
    openInstallPermission: vi.fn(() => true),
    addListener: vi.fn(
      (_event: 'onUpdateDownload', listener: (payload: UpdateDownloadEvent) => void) => {
        emit = listener
        return { remove: () => {} }
      }
    )
  }
  const openInBrowser = vi.fn()
  const installer = createVoiceUpdateInstaller({
    native: () => (opts.moduleMissing ? null : native),
    isForeground: () => state.foreground,
    subscribeForeground: (onForeground) => {
      returnToApp = onForeground
    },
    openInBrowser
  })
  return {
    installer,
    native,
    openInBrowser,
    state,
    progress: (percent: number) => emit({ event: 'progress', percent, message: null }),
    done: () => emit({ event: 'done', percent: null, message: null }),
    fail: (message: string) => emit({ event: 'failed', percent: null, message }),
    returnToApp: () => returnToApp()
  }
}

describe('the in-app update', () => {
  it('shows progress and opens the installer as soon as the download ends', () => {
    const h = harness()
    h.installer.install(URL_A)
    expect(h.installer.getStatus()).toEqual({ phase: 'downloading', url: URL_A, percent: 0 })
    h.progress(42)
    expect(h.installer.getStatus()).toEqual({ phase: 'downloading', url: URL_A, percent: 42 })
    h.done()
    expect(h.installer.getStatus()).toEqual({ phase: 'ready', url: URL_A })
    expect(h.native.openUpdateInstaller).toHaveBeenCalledTimes(1)
  })

  it('never reaches the browser on a second tap during the download', () => {
    const h = harness()
    h.installer.install(URL_A)
    h.installer.install(URL_A)
    expect(h.native.installUpdate).toHaveBeenCalledTimes(1)
    expect(h.openInBrowser).not.toHaveBeenCalled()
  })

  it('reopens a dismissed installer without downloading again', () => {
    const h = harness()
    h.installer.install(URL_A)
    h.done()
    h.installer.install(URL_A)
    expect(h.native.installUpdate).toHaveBeenCalledTimes(1)
    expect(h.native.openUpdateInstaller).toHaveBeenCalledTimes(2)
  })

  it('downloads a newer build rather than installing the one on the phone', () => {
    const h = harness()
    h.installer.install(URL_A)
    h.done()
    h.installer.install(
      'https://github.com/tomaszklin/orca-voice/releases/download/voice-b45/b.apk'
    )
    expect(h.native.installUpdate).toHaveBeenCalledTimes(2)
  })

  it('waits for the app to return when the download ends in the background', () => {
    const h = harness()
    h.installer.install(URL_A)
    h.state.foreground = false
    h.done()
    expect(h.native.openUpdateInstaller).not.toHaveBeenCalled()
    h.state.foreground = true
    h.returnToApp()
    expect(h.native.openUpdateInstaller).toHaveBeenCalledTimes(1)
    h.returnToApp()
    expect(h.native.openUpdateInstaller).toHaveBeenCalledTimes(1)
  })

  it('asks for the install permission first and resumes when it is granted', () => {
    const h = harness({ allowed: false })
    h.installer.install(URL_A)
    expect(h.installer.getStatus()).toEqual({ phase: 'allow', url: URL_A })
    expect(h.native.openInstallPermission).toHaveBeenCalledTimes(1)
    expect(h.native.installUpdate).not.toHaveBeenCalled()
    h.returnToApp()
    expect(h.installer.getStatus().phase).toBe('allow')
    h.state.allowed = true
    h.returnToApp()
    expect(h.native.installUpdate).toHaveBeenCalledWith(URL_A)
  })

  it('downloads anyway when the permission screen cannot open: the installer asks itself', () => {
    const h = harness({ allowed: false })
    h.native.openInstallPermission.mockReturnValue(false)
    h.installer.install(URL_A)
    expect(h.native.installUpdate).toHaveBeenCalledWith(URL_A)
  })

  it('reports a failed download and retries it', () => {
    const h = harness()
    h.installer.install(URL_A)
    h.fail('HTTP 404')
    expect(h.installer.getStatus()).toEqual({ phase: 'failed', url: URL_A, message: 'HTTP 404' })
    h.installer.install(URL_A)
    expect(h.native.installUpdate).toHaveBeenCalledTimes(2)
    expect(h.openInBrowser).not.toHaveBeenCalled()
  })

  it('fails visibly when the installer does not open', () => {
    const h = harness()
    h.native.openUpdateInstaller.mockReturnValue(false)
    h.installer.install(URL_A)
    h.done()
    expect(h.installer.getStatus().phase).toBe('failed')
  })

  it('dismisses a finished update but not a running download', () => {
    const h = harness()
    h.installer.install(URL_A)
    h.installer.dismiss()
    expect(h.installer.getStatus().phase).toBe('downloading')
    h.done()
    h.installer.dismiss()
    expect(h.installer.getStatus()).toEqual({ phase: 'idle' })
  })

  it('falls back to the browser only without the native module', () => {
    const h = harness({ moduleMissing: true })
    h.installer.install(URL_A)
    expect(h.openInBrowser).toHaveBeenCalledExactlyOnceWith(URL_A)
  })
})
