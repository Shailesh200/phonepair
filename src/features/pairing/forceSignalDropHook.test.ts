import { describe, it, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS,
  FORCE_SIGNAL_DROP_HOOK_CAP_MS,
  FORCE_SIGNAL_DROP_HOOK_FAST_PHASE_MS,
  FORCE_SIGNAL_OPEN_WATCHDOG_MS,
  ForceSignalRunner,
  forceSignalDropHookBackoffMs,
  forceSignalReconnect,
  type ForceSignalPeerLike,
} from './forceSignalReconnect.ts'
import { WS_CONNECTING } from './forceSignalPeerState.ts'

function makeRunner(t: { value: number }) {
  return new ForceSignalRunner({
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => { if (id != null) clearTimeout(id) },
    now: () => t.value,
  })
}

function makeConnectingPeer(connectStarted: number) {
  let sockets = 1
  return {
    destroyed: false,
    disconnected: false,
    open: false,
    signalReadyState: () => WS_CONNECTING,
    signalConnectStartedAt: () => connectStarted,
    disconnect() {
      this.disconnected = true
    },
    reconnect() {
      this.disconnected = false
      sockets += 1
    },
    sockets,
  } satisfies ForceSignalPeerLike & { sockets: number }
}

describe('forceSignalDropHookBackoffMs', () => {
  const drop = 1000

  it('schedules 1s, 2s, 4s, 5s, 5s within the first 2 minutes after drop', () => {
    assert.equal(forceSignalDropHookBackoffMs(1, drop, drop), 1000)
    assert.equal(forceSignalDropHookBackoffMs(2, drop, drop + 1000), 2000)
    assert.equal(forceSignalDropHookBackoffMs(3, drop, drop + 5000), 4000)
    assert.equal(forceSignalDropHookBackoffMs(4, drop, drop + 10_000), FORCE_SIGNAL_DROP_HOOK_CAP_MS)
    assert.equal(forceSignalDropHookBackoffMs(9, drop, drop + 90_000), FORCE_SIGNAL_DROP_HOOK_CAP_MS)
  })

  it('uses 10s after 2 minutes from drop', () => {
    assert.equal(
      forceSignalDropHookBackoffMs(5, drop, drop + FORCE_SIGNAL_DROP_HOOK_FAST_PHASE_MS),
      10_000,
    )
  })
})

describe('forceSignalRunner connecting grace', () => {
  afterEach(() => {
    mock.timers.reset()
  })

  it('does not close a young CONNECTING socket on a 5s drop-hook retry', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const t = { value: 0 }
    const runner = makeRunner(t)
    runner.onSignalingDrop()
    t.value = 1000
    const peer = makeConnectingPeer(t.value)
    assert.equal(peer.sockets, 1)
    runner.hook(peer, false)
    assert.equal(peer.sockets, 1)
    t.value = 1000 + FORCE_SIGNAL_OPEN_WATCHDOG_MS + 1
    mock.timers.tick(FORCE_SIGNAL_OPEN_WATCHDOG_MS + 1)
    assert.equal(peer.sockets, 1)
    t.value = 1000 + 5000
    mock.timers.tick(5000)
    assert.equal(peer.sockets, 1)
    t.value = 1000 + FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS + 1
    mock.timers.tick(FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS + 1)
    assert.ok(peer.sockets >= 1)
    runner.stop()
  })
})
