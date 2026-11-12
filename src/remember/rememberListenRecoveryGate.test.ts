import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_NAVIGATOR_OFFLINE_GATE_MS,
  HOST_STUCK_OFFLINE_BOOTSTRAP_PACE_MS,
  hostNavigatorOfflineTooLong,
  hostStuckOfflineBootstrapDue,
  shouldDeferListenBootstrapWhileOffline,
  shouldHostArmListenIdRecovery,
  shouldHostRememberSignalWork,
} from './rememberListenRecoveryGate.ts'

describe('shouldHostArmListenIdRecovery', () => {
  it('arms only when this tab owned the listen id and did not give up', () => {
    assert.equal(
      shouldHostArmListenIdRecovery({
        hasRememberPhones: true,
        listenOwnedBefore: true,
        listenGaveUp: false,
      }),
      true,
    )
    assert.equal(
      shouldHostArmListenIdRecovery({
        hasRememberPhones: true,
        listenOwnedBefore: false,
        listenGaveUp: false,
      }),
      false,
    )
    assert.equal(
      shouldHostArmListenIdRecovery({
        hasRememberPhones: true,
        listenOwnedBefore: true,
        listenGaveUp: true,
      }),
      false,
    )
  })

  it('case 8: code drop on a tab that never owned the listen id must not arm listen sockets', () => {
    assert.equal(
      shouldHostArmListenIdRecovery({
        hasRememberPhones: true,
        listenOwnedBefore: false,
        listenGaveUp: false,
      }),
      false,
    )
  })
})

describe('navigator offline gate', () => {
  const t0 = 100_000

  it('defers bootstrap while offline until the cap, then allows stuck-offline pace', () => {
    assert.equal(shouldDeferListenBootstrapWhileOffline(false, t0, t0 + 1000), true)
    assert.equal(
      shouldDeferListenBootstrapWhileOffline(false, t0, t0 + HOST_NAVIGATOR_OFFLINE_GATE_MS),
      false,
    )
    assert.equal(shouldHostRememberSignalWork(false, false, t0, t0 + 1000), false)
    assert.equal(
      shouldHostRememberSignalWork(false, false, t0, t0 + HOST_NAVIGATOR_OFFLINE_GATE_MS),
      true,
    )
    assert.equal(hostNavigatorOfflineTooLong(false, t0, t0 + HOST_NAVIGATOR_OFFLINE_GATE_MS - 1), false)
    assert.equal(hostNavigatorOfflineTooLong(false, t0, t0 + HOST_NAVIGATOR_OFFLINE_GATE_MS), true)
  })

  it('stuck-offline bootstrap runs at most every 10s', () => {
    assert.equal(hostStuckOfflineBootstrapDue(null, t0), true)
    assert.equal(hostStuckOfflineBootstrapDue(t0, t0 + 9999), false)
    assert.equal(hostStuckOfflineBootstrapDue(t0, t0 + HOST_STUCK_OFFLINE_BOOTSTRAP_PACE_MS), true)
  })
})
