import { useCallback, useEffect, useState } from 'react'
import {
  appUpdateChecker,
  installedVersionLabel,
  openAppUpdate,
  useAppUpdateState
} from '../app-update/app-update-runtime'
import { AppUpdateSettingsRows, type AppUpdateCheckRowStatus } from './app-update-settings-rows'

export function SettingsAppUpdateSection() {
  const state = useAppUpdateState()
  const [result, setResult] = useState<'up-to-date' | 'failed' | null>(null)
  const runCheck = useCallback(() => {
    setResult(null)
    void appUpdateChecker.checkNow().then((outcome) => {
      setResult(outcome === 'available' ? null : outcome)
    })
  }, [])

  // Orca Voice fork: opening Settings checks too.
  useEffect(runCheck, [runCheck])

  const checkStatus: AppUpdateCheckRowStatus = state.checking ? 'checking' : (result ?? 'idle')
  return (
    <AppUpdateSettingsRows
      installedVersion={installedVersionLabel}
      available={state.available}
      lastCheckedAt={state.lastCheckedAt}
      checkStatus={checkStatus}
      onUpdate={openAppUpdate}
      onCheck={runCheck}
    />
  )
}
