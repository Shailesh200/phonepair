import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORCE_SIGNAL_DROP_HOOK_CAP_MS,
  capSignalRetryChainMs,
  capSignalSocketRetryMs,
  forceSignalDropHookBackoffMs,
  forceSignalReconnectBackoffMs,
  forceSignalUnverifiedIntervalMs,
} from './forceSignalReconnect.ts'
import { forceSignalWatchdogDelayMs, WS_CONNECTING } from './forceSignalPeerState.ts'
import { hostReclaimIdBackoffMs } from './hostIdReclaim.ts'
import { listenReclaimIdBackoffMs } from '../../remember/listenIdReclaim.ts'
import { HOST_STUCK_OFFLINE_BOOTSTRAP_PACE_MS } from '../../remember/rememberListenRecoveryGate.ts'
import { LISTEN_RECOVERY_ID_BACKOFF_MS } from '../../remember/listenIdRecovery.ts'
import { redialDelayAfterPeerUnavailable, redialDelayMs } from './reconnect.ts'

const CAP = FORCE_SIGNAL_DROP_HOOK_CAP_MS

function assertCapped(label: string, ms: number) {
  assert.ok(ms <= CAP, `${label}: ${ms} > ${CAP}`)
}

describe('signal socket retry cap (5s)', () => {
  it('cap helper and chained watchdog+backoff', () => {
    assert.equal(capSignalSocketRetryMs(12_000), CAP)
    const chain = capSignalRetryChainMs(3000, 4000)
    assert.equal(chain.watchdogMs + chain.backoffMs, CAP)
    const stacked = capSignalRetryChainMs(4000, 4000)
    assert.equal(stacked.watchdogMs + stacked.backoffMs, CAP)
  })

  it('forceSignalReconnectBackoffMs every attempt', () => {
    for (let a = 1; a <= 12; a += 1) {
      assertCapped(`reconnect attempt ${a}`, forceSignalReconnectBackoffMs(a))
    }
  })

  it('forceSignalDropHookBackoffMs including post-2min', () => {
    const drop = 1000
    for (let a = 1; a <= 12; a += 1) {
      assertCapped(`hook attempt ${a}`, forceSignalDropHookBackoffMs(a, drop, drop))
      assertCapped(
        `hook late attempt ${a}`,
        forceSignalDropHookBackoffMs(a, drop, drop + 3 * 60_000),
      )
    }
  })

  it('unverified cadence interval (was 12s / 60s)', () => {
    assertCapped('fast cadence', forceSignalUnverifiedIntervalMs(0))
    assertCapped('slow cadence', forceSignalUnverifiedIntervalMs(10 * 60_000))
  })

  it('watchdog while CONNECTING (was up to 10s grace)', () => {
    const peer = {
      destroyed: false,
      disconnected: false,
      open: false,
      signalReadyState: () => WS_CONNECTING,
      signalConnectStartedAt: () => 0,
    }
    assertCapped('watchdog verified', forceSignalWatchdogDelayMs(peer, 5000, 3000, false))
    assertCapped('watchdog unverified', forceSignalWatchdogDelayMs(peer, 5000, 3000, true))
  })

  it('listen and code reclaim backoffs', () => {
    for (let a = 1; a <= 10; a += 1) {
      assertCapped(`listen reclaim ${a}`, listenReclaimIdBackoffMs(a))
      assertCapped(`host reclaim ${a}`, hostReclaimIdBackoffMs(a))
    }
  })

  it('offline pace and recovery reclaim spacing', () => {
    assertCapped('stuck-offline bootstrap pace', HOST_STUCK_OFFLINE_BOOTSTRAP_PACE_MS)
    assertCapped('listen recovery reclaim', LISTEN_RECOVERY_ID_BACKOFF_MS)
  })

  it('guest dial delays after peer-unavailable', () => {
    for (let n = 0; n <= 8; n += 1) {
      assertCapped(`redial ${n}`, redialDelayMs(n, true))
      assertCapped(`unavailable redial ${n}`, redialDelayAfterPeerUnavailable(n, true))
    }
  })
})
