import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  listenForceResumesAfterRecoverySettle,
  listenForceTickBlockedByRecoveryMode,
  listenRecoveryReclaimIntervalMs,
  listenRecoveryAwaitingServerOpenSinceDrop,
  listenRecoveryServerOpenAfterDrop,
  listenRecoveryReclaimSchedulingActive,
  listenRecoveryStaleOpenNeedsImmediateRecycle,
  shouldForceHookOnRecoveryRearm,
  shouldOneShotRecoveryRearm,
  shouldRearmListenAfterServerReopen,
  listenReclaimRecycleSkipsConnectingPeer,
  listenReclaimRecycleSkipsOpenSocket,
  shouldBeginListenIdRecoveryOnDataConnClose,
  shouldListenReclaimRecyclePeer,
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

  it('recovery tick keeps going until server OPEN after the drop', () => {
    assert.equal(listenRecoveryAwaitingServerOpenSinceDrop(1000, null), true)
    assert.equal(listenRecoveryAwaitingServerOpenSinceDrop(1000, 999), true)
    assert.equal(listenRecoveryAwaitingServerOpenSinceDrop(1000, 1001), false)
    assert.equal(listenRecoveryAwaitingServerOpenSinceDrop(null, 500), false)
  })

  it('case11: after server OPEN post-cut, listen must re-arm until phone dial accepted', () => {
    const dropAt = 20_000
    const serverOpenAt = dropAt + 4500
    assert.equal(listenRecoveryServerOpenAfterDrop(dropAt, serverOpenAt), true)
    assert.equal(listenRecoveryServerOpenAfterDrop(dropAt, dropAt), false)
    assert.equal(shouldRearmListenAfterServerReopen(dropAt, serverOpenAt, false), true)
    assert.equal(shouldRearmListenAfterServerReopen(dropAt, serverOpenAt, true), false)
    assert.equal(shouldRearmListenAfterServerReopen(dropAt, null, false), false)
  })

  it('healthy post-drop listen socket: recovery rearm reloads only, no force hook', () => {
    assert.equal(shouldForceHookOnRecoveryRearm(true, false), false)
    assert.equal(shouldForceHookOnRecoveryRearm(false, false), true)
    assert.equal(shouldForceHookOnRecoveryRearm(true, true), true)
  })

  it('recovery rearm is one-shot per serverOpenAt (4s ticks cannot recycle)', () => {
    const openAt = 50_000
    assert.equal(shouldOneShotRecoveryRearm(openAt, null), true)
    assert.equal(shouldOneShotRecoveryRearm(openAt, openAt), false)
    assert.equal(shouldOneShotRecoveryRearm(openAt + 1, openAt), true)
    assert.equal(shouldOneShotRecoveryRearm(null, openAt), true)
  })

  it('stops reclaim polling after the 120s cap when OPEN never arrives', () => {
    const dropAt = 0
    const until = dropAt + 120_000
    assert.equal(listenRecoveryReclaimSchedulingActive(true, until, until - 1), true)
    assert.equal(listenRecoveryReclaimSchedulingActive(false, until, until), false)
    assert.equal(listenRecoveryReclaimSchedulingActive(false, until, until + 1), false)
  })

  it('stale open with no server OPEN recycles immediately; reclaim polls within ~3s', () => {
    const dropAt = 10_000
    assert.equal(listenRecoveryStaleOpenNeedsImmediateRecycle(true, dropAt, null), true)
    assert.equal(listenRecoveryStaleOpenNeedsImmediateRecycle(true, dropAt, dropAt + 100), false)
    assert.equal(listenRecoveryReclaimIntervalMs(), 2500)
    assert.ok(listenRecoveryReclaimIntervalMs() <= 3000)
  })

  it('reclaim re-arm: fresh connecting peer younger than 8s survives; aged peer is recycled', () => {
    const dropAt = 10_000
    const connectAt = dropAt + 100
    const at25Rearm = connectAt + 2500
    const at9s = connectAt + 9000
    assert.equal(listenReclaimRecycleSkipsConnectingPeer(dropAt, connectAt, false, at25Rearm), true)
    assert.equal(listenReclaimRecycleSkipsConnectingPeer(dropAt, connectAt, false, at9s), false)
    assert.equal(shouldListenReclaimRecyclePeer({
      deferRecycle: false,
      listenOpen: false,
      listenDisconnected: false,
      recoveryDropAt: dropAt,
      serverOpenAt: null,
      connectStartedAt: connectAt,
      now: at25Rearm,
    }), false)
    assert.equal(shouldListenReclaimRecyclePeer({
      deferRecycle: false,
      listenOpen: false,
      listenDisconnected: false,
      recoveryDropAt: dropAt,
      serverOpenAt: null,
      connectStartedAt: connectAt,
      now: at9s,
    }), true)
  })

  it('reclaim recycle defers while remember dial or auth is in flight', () => {
    const dropAt = 10_000
    assert.equal(shouldListenReclaimRecyclePeer({
      deferRecycle: true,
      listenOpen: false,
      listenDisconnected: false,
      recoveryDropAt: dropAt,
      serverOpenAt: null,
      connectStartedAt: null,
      now: dropAt + 5000,
    }), false)
  })

  it('reclaim recycle: stale open (OPEN before drop) is recycled; fresh open is kept', () => {
    const dropAt = 10_000
    const staleOpenAt = dropAt - 500
    const freshOpenAt = dropAt + 200
    assert.equal(listenReclaimRecycleSkipsOpenSocket(true, false, dropAt, staleOpenAt), false)
    assert.equal(listenReclaimRecycleSkipsOpenSocket(true, false, dropAt, freshOpenAt), true)
    assert.equal(listenReclaimRecycleSkipsOpenSocket(true, false, dropAt, null), false)
    assert.equal(listenReclaimRecycleSkipsOpenSocket(true, false, null, freshOpenAt), true)
    assert.equal(listenReclaimRecycleSkipsOpenSocket(false, false, dropAt, freshOpenAt), false)
    assert.equal(listenReclaimRecycleSkipsOpenSocket(true, true, dropAt, freshOpenAt), false)
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
