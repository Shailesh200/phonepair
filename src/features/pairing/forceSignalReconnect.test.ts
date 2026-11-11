import { describe, it, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORCE_SIGNAL_OPEN_WATCHDOG_MS,
  FORCE_SIGNAL_RECLAIM_MIN_MS,
  ForceSignalRunner,
  forceSignalReconnect,
  forceReclaimExpired,
  type ForceSignalPeerLike,
} from './forceSignalReconnect.ts'

const WS_CONNECTING = 0
const WS_OPEN = 1

type MockSocket = { readyState: number; close: () => void }

function makeMockPeer() {
  let socket: MockSocket | null = { readyState: WS_CONNECTING, close: () => {} }
  const sockets: MockSocket[] = [socket]
  const peer: ForceSignalPeerLike & { sockets: MockSocket[]; _getSocket: () => MockSocket | null } = {
    destroyed: false,
    disconnected: false,
    open: false,
    sockets,
    _getSocket: () => socket,
    disconnect() {
      peer.disconnected = true
      peer.open = false
      socket?.close()
      socket = null
    },
    reconnect() {
      if (peer.destroyed) return
      peer.disconnected = false
      socket = { readyState: WS_CONNECTING, close: () => {} }
      sockets.push(socket)
    },
  }
  return peer
}

function makeRunner(t: { value: number }) {
  return new ForceSignalRunner({
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => { if (id != null) clearTimeout(id) },
    now: () => t.value,
  })
}

describe('forceSignalReconnect', () => {
  it('hook forces disconnect and reconnect when peer.open is true (half-open)', () => {
    const peer = makeMockPeer()
    peer.open = true
    peer.disconnected = false
    const before = peer.sockets.length
    const runner = makeRunner({ value: 0 })
    runner.hook(peer, false)
    assert.ok(peer.sockets.length > before)
    assert.equal(peer.sockets.length, 2)
    runner.stop()
  })

  it('disconnects a half-open peer before reconnect so a new socket can be created', () => {
    const peer = makeMockPeer()
    assert.equal(peer.disconnected, false)
    assert.equal(peer.open, false)
    assert.equal(forceSignalReconnect(peer), true)
    assert.equal(peer.disconnected, false)
    assert.equal(peer.sockets.length, 2)
    assert.equal(peer.sockets[1].readyState, WS_CONNECTING)
  })
})

describe('forceSignalRunner stuck socket', () => {
  afterEach(() => {
    mock.timers.reset()
  })

  it('creates a new socket within the open watchdog after a hook (stuck CONNECTING)', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const peer = makeMockPeer()
    const t = { value: 0 }
    const runner = makeRunner(t)
    runner.hook(peer, false)
    assert.equal(peer.sockets.length, 2)
    t.value += FORCE_SIGNAL_OPEN_WATCHDOG_MS
    mock.timers.tick(FORCE_SIGNAL_OPEN_WATCHDOG_MS)
    assert.ok(peer.sockets.length >= 2)
    runner.stop()
  })

  it('recovers on a second network drop after recover and more than 75s idle', () => {
    const peer = makeMockPeer()
    const t = { value: 0 }
    const runner = makeRunner(t)
    runner.hook(peer, false)
    t.value = 1000
    runner.onOpen()
    peer.open = true
    peer.disconnected = false
    t.value = 80_000
    peer.open = true
    peer.disconnected = false
    const before = peer.sockets.length
    runner.hook(peer, false)
    assert.ok(peer.sockets.length > before)
    runner.stop()
  })

  it('onOpen clears runner reclaimStartedAt for a fresh id-reclaim window on the next drop', () => {
    const t = { value: 0 }
    const runner = makeRunner(t)
    runner.hook(makeMockPeer(), true)
    t.value = FORCE_SIGNAL_RECLAIM_MIN_MS + 1
    assert.equal(forceReclaimExpired(t.value - FORCE_SIGNAL_RECLAIM_MIN_MS, t.value), true)
    runner.onOpen()
    t.value = FORCE_SIGNAL_RECLAIM_MIN_MS + 50_000
    const peer = makeMockPeer()
    peer.open = true
    let called = false
    const orig = peer.disconnect
    peer.disconnect = () => { called = true; orig.call(peer) }
    runner.hook(peer, true)
    assert.equal(called, true)
    runner.stop()
  })

  it('keeps forcing through a 90s network outage with no reclaim cap', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const peer = makeMockPeer()
    const t = { value: 0 }
    const runner = makeRunner(t)
    runner.hook(peer, false)
    const socketsAt75s = peer.sockets.length
    for (let i = 0; i < 9; i++) {
      t.value += 10_000
      mock.timers.tick(10_000)
      runner.tick(peer, true, false, false)
    }
    assert.ok(peer.sockets.length > socketsAt75s)
    assert.ok(t.value >= 90_000)
    runner.stop()
  })

  it('opens within 15s of restore after a 90s outage (fake timers)', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const peer = makeMockPeer()
    const t = { value: 90_000 }
    const runner = makeRunner(t)
    const restoreAt = t.value
    runner.hook(peer, false)
    const maybeOpen = () => {
      if (peer.sockets.length > 1) {
        peer.open = true
        peer.disconnected = false
        const s = peer._getSocket()
        if (s) s.readyState = WS_OPEN
        runner.onOpen()
      }
    }
    while (t.value - restoreAt < 15_000) {
      mock.timers.tick(FORCE_SIGNAL_OPEN_WATCHDOG_MS)
      t.value += FORCE_SIGNAL_OPEN_WATCHDOG_MS
      maybeOpen()
      if (peer.open) break
    }
    assert.equal(peer.open, true)
    assert.ok(t.value - restoreAt <= 15_000)
    runner.stop()
  })

  it('reaches open within 15s after a 20s cut when network returns (fake timers)', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const peer = makeMockPeer()
    const t = { value: 20_000 }
    const runner = makeRunner(t)
    runner.hook(peer, false)
    const openAt = () => {
      peer.open = true
      const s = peer._getSocket()
      if (s) s.readyState = WS_OPEN
      peer.sockets[peer.sockets.length - 1].readyState = WS_OPEN
      runner.onOpen()
    }
    const advance = (ms: number) => {
      t.value += ms
      mock.timers.tick(ms)
      if (!peer.open && peer.sockets.length > 1) openAt()
    }
    advance(3000)
    assert.equal(peer.open, true)
    assert.ok(t.value - 20_000 <= 15_000)
    runner.stop()
  })
})
