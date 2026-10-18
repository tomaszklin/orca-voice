import { AppState, Platform } from 'react-native'
import { connect, type RpcClient } from './rpc-client'
import { createStableLogicalRpcClient } from './stable-logical-rpc-client'
import type { ConnectionLogSink, HostProfile } from './types'
import { directPathForEndpoint } from './mobile-direct-endpoint-probe'
import { startMobileEndpointLifecycle } from './mobile-endpoint-lifecycle'
import {
  backgroundReadingActive,
  subscribeBackgroundReading
} from '../speech/background-reading-state'

export function openHostLogicalClient(host: HostProfile, onLog: ConnectionLogSink): RpcClient {
  // Why: the stable facade owns app-visible RPC/subscription state while the
  // direct socket remains a replaceable first physical generation.
  const logical = createStableLogicalRpcClient(
    connect(host.endpoint, host.deviceToken, host.publicKeyB64, { onLog }),
    directPathForEndpoint(host.endpoint)
  )
  if (Platform.OS === 'web') {
    return logical
  }

  const endpointLifecycle = startMobileEndpointLifecycle(logical, host, onLog)
  // Orca Voice fork: while the background reader runs, the link stays foreground so it is not
  // dropped 30 seconds after the screen goes off.
  const isForeground = (state = AppState.currentState) =>
    state === 'active' || backgroundReadingActive()
  endpointLifecycle.setForeground(isForeground())
  const appStateSubscription = AppState.addEventListener('change', (state) => {
    endpointLifecycle.setForeground(isForeground(state))
  })
  const unsubscribeBackgroundReading = subscribeBackgroundReading(() =>
    endpointLifecycle.setForeground(isForeground())
  )
  const closeLogical = logical.close
  logical.close = () => {
    unsubscribeBackgroundReading()
    appStateSubscription.remove()
    endpointLifecycle.stop()
    closeLogical()
  }
  const notifyLogicalForeground = logical.notifyForeground
  logical.notifyForeground = (reason = 'focus') => {
    // Why: a nudge while already foreground must not re-enter setForeground —
    // that path suspended healthy relays; the supervisor probes or replaces instead.
    endpointLifecycle.nudge(reason)
    notifyLogicalForeground(reason)
  }
  return logical
}
