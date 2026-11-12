import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldDeferListenForceRecycle } from './listenForceRecycleDefer.ts'
import { listenRecoveryStateIsCleared } from './listenRecoveryLifecycle.ts'

describe('listen force recycle defer', () => {
  it('defers while host auth, guest dial, or pending conn is in flight', () => {
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: true,
      guestDialInFlight: false,
      pendingDataConn: false,
    }), true)
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: false,
      guestDialInFlight: true,
      pendingDataConn: false,
    }), true)
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: false,
      guestDialInFlight: false,
      pendingDataConn: true,
    }), true)
    assert.equal(shouldDeferListenForceRecycle({
      hostRememberAuthPending: false,
      guestDialInFlight: false,
      pendingDataConn: false,
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
