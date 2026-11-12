import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  listenForceResumesAfterRecoverySettle,
  listenForceTickBlockedByRecoveryMode,
  listenReclaimRecycleSkipsOpenSocket,
  shouldBeginListenIdRecoveryOnDataConnClose,
  shouldClearStaleRememberMainConnForRecovery,
} from './rememberRecoveryConn.ts'

describe('remember recovery conn hygiene', () => {
  it('data-channel hangup does not start listen-id recovery', () => {
    assert.equal(shouldBeginListenIdRecoveryOnDataConnClose(), false)
  })

  it('does not drop main conn when PC is alive on signal recovery', () => {
    const now = 100_000
    assert.equal(
      shouldClearStaleRememberMainConnForRecovery('host', true, true, {
        everConnected: true,
        iceState: 'connected',
        connectionState: 'connected',
        lastSeen: now,
        now,
      }),
      false,
    )
    assert.equal(
      shouldClearStaleRememberMainConnForRecovery('host', true, true, {
        everConnected: true,
        iceState: 'failed',
        connectionState: 'connected',
        lastSeen: now,
        now,
      }),
      true,
    )
    assert.equal(
      shouldClearStaleRememberMainConnForRecovery('guest', true, true, {
        everConnected: true,
        iceState: 'failed',
        connectionState: 'connected',
        lastSeen: now,
        now,
      }),
      false,
    )
  })

  it('reclaim recycle skips only visibly open listen sockets', () => {
    assert.equal(listenReclaimRecycleSkipsOpenSocket(true, false), true)
    assert.equal(listenReclaimRecycleSkipsOpenSocket(false, false), false)
    assert.equal(listenReclaimRecycleSkipsOpenSocket(true, true), false)
  })

  it('listen force resumes after recovery settle for silent socket handling', () => {
    const openAt = 10_000
    const settleUntil = openAt + 4000
    const clearAt = openAt + 4000
    assert.equal(listenForceTickBlockedByRecoveryMode(true), true)
    assert.equal(listenForceResumesAfterRecoverySettle(true, clearAt - 1, clearAt, settleUntil), false)
    assert.equal(listenForceResumesAfterRecoverySettle(true, clearAt, clearAt, settleUntil), true)
    assert.equal(listenForceResumesAfterRecoverySettle(false, clearAt, clearAt, settleUntil), true)
  })
})
