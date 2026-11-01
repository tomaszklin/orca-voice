import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppUpdateSettingsRows, type AppUpdateCheckRowStatus } from './app-update-settings-rows'

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  Text: 'Text',
  View: 'View'
}))

const NOW = Date.UTC(2026, 8, 28, 12)
const HOUR = 60 * 60 * 1000

describe('AppUpdateSettingsRows', () => {
  let renderer: ReactTestRenderer | null = null
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  function render(opts: {
    available?: { version: string; url: string } | null
    lastCheckedAt?: number | null
    checkStatus?: AppUpdateCheckRowStatus
  }) {
    const onUpdate = vi.fn()
    const onCheck = vi.fn()
    act(() => {
      renderer = create(
        createElement(AppUpdateSettingsRows, {
          installedVersion: '0.0.48',
          available: opts.available ?? null,
          lastCheckedAt: opts.lastCheckedAt ?? null,
          checkStatus: opts.checkStatus ?? 'idle',
          onUpdate,
          onCheck
        })
      )
    })
    const root = renderer!.root
    const texts = root
      .findAll((node) => String(node.type) === 'Text')
      .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
    return {
      root,
      texts,
      onUpdate,
      onCheck,
      pressables: root.findAll((node) => String(node.type) === 'Pressable')
    }
  }

  it('offers the known update in the version row, with the new version number', () => {
    const { texts, pressables, onUpdate, onCheck } = render({
      available: { version: 'build 46', url: 'https://example.test' },
      lastCheckedAt: NOW - 2 * HOUR
    })
    expect(texts).toEqual(['Version 0.0.48', 'Update to build 46'])
    expect(pressables).toHaveLength(1)
    act(() => pressables[0].props.onPress())
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith('https://example.test')
    expect(onCheck).not.toHaveBeenCalled()
  })

  it('shows Check before a first success and Up to date after one', () => {
    expect(render({}).texts).toEqual(['Version 0.0.48', 'Check'])
    act(() => renderer?.unmount())
    expect(render({ lastCheckedAt: NOW - HOUR }).texts).toEqual(['Version 0.0.48', 'Up to date'])
  })

  it('runs the check from the version row and shows its state in place', () => {
    const idle = render({ lastCheckedAt: NOW - 30_000 })
    act(() => idle.pressables[0].props.onPress())
    expect(idle.onCheck).toHaveBeenCalledTimes(1)
    act(() => renderer?.unmount())
    const checking = render({ checkStatus: 'checking' })
    expect(checking.pressables[0].props.disabled).toBe(true)
    expect(checking.texts.at(-1)).toBe('Checking…')
    act(() => renderer?.unmount())
    expect(render({ checkStatus: 'failed', lastCheckedAt: NOW }).texts.at(-1)).toBe(
      "Couldn't check"
    )
  })
})
