import { describe, it, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORCE_SIGNAL_CONNECTING_GRACE_MS,
  FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS,
  FORCE_SIGNAL_DROP_HOOK_FAST_PHASE_MS,
  FORCE_SIGNAL_OPEN_WATCHDOG_MS,
  ForceSignalRunner,
  forceSignalConnectingGraceMs,
  type ForceSignalPeerLike,
} from './forceSignalReconnect.ts'
import {
  forceSignalWatchdogDelayMs,
  mayForceReplaceSignalSocket,
  WS_CONNECTING,
} from './forceSignalPeerState.ts'

function makeConnectingPeer(connectStarted: number) {
  return {
    destroyed: false,
    disconnected: false,
    open: false,
    signalReadyState: () => WS_CONNECTING,
    signalConnectStartedAt: () => connectStarted,
    disconnect() { this.disconnected = true },
    reconnect() {},
  } satisfies ForceSignalPeerLike
}

describe('forceSignalConnectingGraceMs', () => {
  it('uses 3s while unverified after drop, 10s otherwise', () => {
    assert.equal(forceSignalConnectingGraceMs(true), FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS)
    assert.equal(forceSignalConnectingGraceMs(false), FORCE_SIGNAL_CONNECTING_GRACE_MS)
    assert.equal(FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS, 3000)
  })

  it('keeps 3s grace unverified even after 2+ minutes from drop', () => {
    const drop = 0
    const now = drop + FORCE_SIGNAL_DROP_HOOK_FAST_PHASE_MS + 60_000
    const peer = makeConnectingPeer(now - 1000)
    assert.equal(
      mayForceReplaceSignalSocket(peer, now, { unverifiedAfterDrop: true }),
      false,
    )
    assert.equal(
      mayForceReplaceSignalSocket(peer, now, { unverifiedAfterDrop: true, mode: 'hook' }),
      false,
    )
    const oldEnough = makeConnectingPeer(now - FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS - 1)
    assert.equal(
      mayForceReplaceSignalSocket(oldEnough, now, { unverifiedAfterDrop: true }),
      true,
    )
  })

  it('uses 10s grace when not unverified', () => {
    const now = 50_000
    const peer = makeConnectingPeer(now - 5000)
    assert.equal(mayForceReplaceSignalSocket(peer, now, { unverifiedAfterDrop: false }), false)
    const aged = makeConnectingPeer(now - FORCE_SIGNAL_CONNECTING_GRACE_MS)
    assert.equal(mayForceReplaceSignalSocket(aged, now, { unverifiedAfterDrop: false }), true)
  })
})

describe('forceSignalWatchdog while unverified', () => {
  it('caps watchdog at 3s while unverified', () => {
    const now = 1000
    const peer = makeConnectingPeer(now)
    const delay = forceSignalWatchdogDelayMs(peer, now, FORCE_SIGNAL_OPEN_WATCHDOG_MS, true)
    assert.equal(delay, FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS)
  })
})

describe('unverified tick recovery', () => {
  afterEach(() => {
    mock.timers.reset()
  })

  it('forces via tick when unverified and the listen peer is not open', () => {
    let forced = false
    const peer = {
      destroyed: false,
      disconnected: true,
      open: false,
      disconnect() { this.disconnected = true },
      reconnect() { forced = true; this.disconnected = false },
    }
    const t = { value: 0 }
    const runner = new ForceSignalRunner({
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => { if (id != null) clearTimeout(id) },
      now: () => t.value,
    })
    runner.onSignalingDrop()
    runner.tick(peer, true, false, false, true)
    assert.equal(forced, true)
    runner.stop()
  })

  it('keeps forcing on watchdog retry backoff while unverified and not open', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const t = { value: 10_000 }
    let peerOpen = false
    const connectStarted = t.value - FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS - 5
    const peer = {
      destroyed: false,
      disconnected: true,
      get open() {
        return peerOpen
      },
      signalReadyState: () => WS_CONNECTING,
      signalConnectStartedAt: () => connectStarted,
      disconnect() {
        this.disconnected = true
      },
      reconnect() {
        this.disconnected = false
      },
    }
    const kinds: string[] = []
    const runner = new ForceSignalRunner(
      {
        setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeout: (id) => { if (id != null) clearTimeout(id) },
        now: () => t.value,
      },
      {
        onRunForce: (k) => kinds.push(k),
      },
    )
    runner.onSignalingDrop()
    runner.tick(peer, true, false, false, true)
    assert.deepEqual(kinds, ['tick'])

    t.value += FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS
    mock.timers.tick(FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS)
    t.value += 2000
    mock.timers.tick(2000)
    assert.ok(kinds.includes('retry'), `expected retry, got ${kinds.join(',')}`)

    peerOpen = true
    t.value += 20_000
    mock.timers.tick(20_000)
    const retries = kinds.filter((k) => k === 'retry').length
    assert.equal(retries, 1)
    runner.stop()
  })
})

describe('hook chain stops on signal open', () => {
  afterEach(() => {
    mock.timers.reset()
  })

  it('does not retry after the peer opens during a drop-hook chain', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const t = { value: 10_000 }
    let peerOpen = false
    const connectStarted = t.value - FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS - 5
    const peer = {
      destroyed: false,
      disconnected: true,
      get open() {
        return peerOpen
      },
      signalReadyState: () => WS_CONNECTING,
      signalConnectStartedAt: () => connectStarted,
      disconnect() {
        this.disconnected = true
      },
      reconnect() {
        this.disconnected = false
      },
    }
    const kinds: string[] = []
    const runner = new ForceSignalRunner(
      {
        setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeout: (id) => { if (id != null) clearTimeout(id) },
        now: () => t.value,
      },
      { onRunForce: (k) => kinds.push(k) },
    )
    runner.onSignalingDrop()
    runner.hook(peer, false)
    assert.ok(kinds.includes('hook'))
    peerOpen = true
    t.value += 20_000
    mock.timers.tick(20_000)
    assert.equal(kinds.filter((k) => k === 'retry').length, 0)
    runner.stop()
  })
})

describe('online CONNECTING bypass', () => {
  it('forces pre-online CONNECTING immediately but not a socket started after online', () => {
    const onlineAt = 10_000
    const preOnline = makeConnectingPeer(onlineAt - 5000)
    assert.equal(
      mayForceReplaceSignalSocket(preOnline, onlineAt, {
        unverifiedAfterDrop: true,
        mode: 'online',
        onlineAt,
      }),
      true,
    )
    const postOnline = makeConnectingPeer(onlineAt + 500)
    assert.equal(
      mayForceReplaceSignalSocket(postOnline, onlineAt + 500, {
        unverifiedAfterDrop: true,
        mode: 'online',
        onlineAt,
      }),
      false,
    )
  })

  afterEach(() => {
    mock.timers.reset()
  })

  it('hookOnline replaces a pre-online CONNECTING socket in one force', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    let sockets = 1
    const connectStarted = 5000
    const peer = {
      destroyed: false,
      disconnected: false,
      open: false,
      signalReadyState: () => WS_CONNECTING,
      signalConnectStartedAt: () => connectStarted,
      disconnect() { this.disconnected = true },
      reconnect() {
        this.disconnected = false
        sockets += 1
      },
      sockets,
    }
    const t = { value: 10_000 }
    const runner = new ForceSignalRunner({
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => { if (id != null) clearTimeout(id) },
      now: () => t.value,
    })
    runner.onSignalingDrop()
    runner.hookOnline(peer, false)
    assert.equal(sockets, 2)
    runner.stop()
  })
})
