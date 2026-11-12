import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { REMEMBER_FORCE_DEFER_AUTH_STALE_MS, shouldDeferListenForceRecycle } from './listenForceRecycleDefer.ts'
import { REMEMBER_PROOF_TIMEOUT_MS } from './gate.ts'
import { listenRecoveryStateIsCleared } from './listenRecoveryLifecycle.ts'

describe('listen force recycle defer', () => {
  it('defers while host auth, guest dial, or pending conn is in flight', () => {
    const now = 50_000
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: true,
      hostAuthPendingStartedAt: now - 1000,
      guestDialInFlight: false,
      pendingDataConn: false,
      now,
    }), true)
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: false,
      hostAuthPendingStartedAt: null,
      guestDialInFlight: true,
      pendingDataConn: false,
      now,
    }), true)
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: false,
      hostAuthPendingStartedAt: null,
      guestDialInFlight: false,
      pendingDataConn: true,
      now,
    }), true)
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: false,
      hostAuthPendingStartedAt: null,
      guestDialInFlight: false,
      pendingDataConn: false,
      now,
    }), false)
  })

  it('does not defer reclaim for stale auth pending past proof timeout', () => {
    const now = 100_000
    const started = now - REMEMBER_FORCE_DEFER_AUTH_STALE_MS - 1
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: true,
      hostAuthPendingStartedAt: started,
      guestDialInFlight: false,
      pendingDataConn: false,
      now,
    }), false)
    assert.ok(REMEMBER_FORCE_DEFER_AUTH_STALE_MS > REMEMBER_PROOF_TIMEOUT_MS)
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: true,
      hostAuthPendingStartedAt: null,
      guestDialInFlight: false,
      pendingDataConn: false,
      now,
    }), false)
  })
})

describe('listen recovery lifecycle', () => {
  it('cleared state has no mode, drop, or reclaim deadline', () => {
    assert.equal(listenRecoveryStateIsCleared({
      listenRecoveryMode: false,
      listenRecoveryDropAt: null,
      listenRecoveryReclaimUntil: null,
    }), true)
    assert.equal(listenRecoveryStateIsCleared({
      listenRecoveryMode: true,
      listenRecoveryDropAt: null,
      listenRecoveryReclaimUntil: null,
    }), false)
  })
})
