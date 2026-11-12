import { describe, it, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORCE_SIGNAL_OPEN_WATCHDOG_MS,
  FORCE_SIGNAL_RECLAIM_MIN_MS,
  FORCE_SIGNAL_VERIFY_CADENCE_MS,
  FORCE_SIGNAL_VERIFY_FAST_PHASE_MS,
  FORCE_SIGNAL_VERIFY_SLOW_CADENCE_MS,
  ForceSignalRunner,
  forceSignalCadenceDue,
  forceSignalReconnect,
  forceReclaimExpired,
  forceSignalUnverifiedIntervalMs,
  shouldForceSignalOnVisibility,
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
      runner.tick(peer, true, false, false, false)
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

  it('cadence-forces a silent open socket and accepts phone connect to stop', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const peer = makeMockPeer()
    const t = { value: 0 }
    const runner = makeRunner(t)
    runner.onSignalingDrop()
    peer.open = true
    peer.disconnected = false
    const before = peer.sockets.length
    t.value = FORCE_SIGNAL_VERIFY_CADENCE_MS
    mock.timers.tick(FORCE_SIGNAL_VERIFY_CADENCE_MS)
    runner.tick(peer, true, false, true, true)
    assert.ok(peer.sockets.length > before)
    let dataAccepted = false
    const onPhone = () => {
      dataAccepted = true
      runner.onPhoneConnected()
    }
    onPhone()
    assert.equal(dataAccepted, true)
    assert.equal(runner.isUnverifiedAfterDrop(), false)
    runner.stop()
  })

  it('opens a new socket within 15s after a 90s silent-open cut on restore', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const peer = makeMockPeer()
    const t = { value: 0 }
    const runner = makeRunner(t)
    runner.onSignalingDrop()
    peer.open = true
    peer.disconnected = false
    while (t.value < 90_000) {
      t.value += FORCE_SIGNAL_VERIFY_CADENCE_MS
      mock.timers.tick(FORCE_SIGNAL_VERIFY_CADENCE_MS)
      runner.tick(peer, true, false, true, true)
    }
    const restoreAt = t.value
    const socketsBefore = peer.sockets.length
    runner.hookOnline(peer, false)
    assert.ok(peer.sockets.length > socketsBefore)
    assert.ok(t.value - restoreAt <= 15_000)
    runner.onPhoneConnected()
    runner.stop()
  })

  it('hookOnline during a pending backoff retry forces immediately', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const peer = makeMockPeer()
    const t = { value: 0 }
    const runner = makeRunner(t)
    runner.hook(peer, false)
    const n = peer.sockets.length
    t.value += FORCE_SIGNAL_OPEN_WATCHDOG_MS
    mock.timers.tick(FORCE_SIGNAL_OPEN_WATCHDOG_MS)
    peer.open = true
    peer.disconnected = false
    const beforeOnline = peer.sockets.length
    runner.hookOnline(peer, false)
    assert.ok(peer.sockets.length > beforeOnline)
    assert.ok(peer.sockets.length >= n + 1)
    runner.stop()
  })

  it('uses 60s cadence after the first 5 minutes of unverified forcing', () => {
    assert.equal(forceSignalUnverifiedIntervalMs(FORCE_SIGNAL_VERIFY_FAST_PHASE_MS - 1), FORCE_SIGNAL_VERIFY_CADENCE_MS)
    assert.equal(forceSignalUnverifiedIntervalMs(FORCE_SIGNAL_VERIFY_FAST_PHASE_MS), FORCE_SIGNAL_VERIFY_SLOW_CADENCE_MS)
    const drop = 0
    assert.equal(forceSignalCadenceDue(drop, drop, drop + FORCE_SIGNAL_VERIFY_CADENCE_MS - 1), false)
    assert.equal(forceSignalCadenceDue(drop, drop, drop + FORCE_SIGNAL_VERIFY_CADENCE_MS), true)
    const lateDrop = 0
    const lateNow = FORCE_SIGNAL_VERIFY_FAST_PHASE_MS + FORCE_SIGNAL_VERIFY_SLOW_CADENCE_MS
    assert.equal(forceSignalCadenceDue(lateDrop, lateDrop, lateNow), true)
  })

  it('does not force visibility rearm when hidden under 30s even if unverified', () => {
    assert.equal(shouldForceSignalOnVisibility(29_000, true), false)
    assert.equal(shouldForceSignalOnVisibility(31_000, true), true)
    assert.equal(shouldForceSignalOnVisibility(31_000, false), false)
  })

  it('peer open after a hook stops watchdog backoff while unverified (cadence only)', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const peer = makeMockPeer()
    const t = { value: 0 }
    const runner = makeRunner(t)
    runner.onSignalingDrop()
    runner.hook(peer, false)
    const afterHook = peer.sockets.length
    peer.open = true
    peer.disconnected = false
    runner.onOpen()
    t.value += 8_000
    mock.timers.tick(8_000)
    assert.equal(peer.sockets.length, afterHook)
    t.value = FORCE_SIGNAL_VERIFY_CADENCE_MS
    runner.tick(peer, true, false, true, true)
    assert.ok(peer.sockets.length > afterHook)
    runner.stop()
  })

  it('does not force over 10 minutes without a signaling drop', () => {
    const peer = makeMockPeer()
    peer.open = true
    peer.disconnected = false
    const runner = makeRunner({ value: 0 })
    const n0 = peer.sockets.length
    for (let i = 0; i < 600; i += 1) {
      runner.tick(peer, true, false, true, false)
    }
    assert.equal(peer.sockets.length, n0)
    runner.stop()
  })

  it('endUnverifiedForcing ends unverified cadence after a deliberate disconnect', () => {
    const peer = makeMockPeer()
    const runner = makeRunner({ value: 0 })
    runner.onSignalingDrop()
    assert.equal(runner.isUnverifiedAfterDrop(), true)
    runner.endUnverifiedForcing()
    assert.equal(runner.isUnverifiedAfterDrop(), false)
    peer.open = true
    peer.disconnected = false
    const before = peer.sockets.length
    runner.tick(peer, true, false, true, true)
    assert.equal(peer.sockets.length, before)
    runner.stop()
  })

  it('post-settle silent open listen peer is cadence-forced when watch is preserved', () => {
    const dropAt = 0
    const t = { value: dropAt }
    const peer = makeMockPeer()
    peer.open = true
    peer.disconnected = false
    const peerExt = {
      ...peer,
      signalReadyState: () => WS_OPEN,
      signalPeerOpenAt: () => dropAt,
    }
    const runner = makeRunner(t)
    runner.onSignalingDrop()
    runner.endUnverifiedForcing(true)
    t.value = dropAt + FORCE_SIGNAL_VERIFY_CADENCE_MS
    assert.equal(runner.isUnverifiedAfterDrop(), false)
    const before = peer.sockets.length
    runner.tick(peerExt, true, false, false, false)
    assert.ok(peer.sockets.length > before)
    runner.stop()
  })

  it('post-settle silent watch stops after one verified-live cadence check', () => {
    const dropAt = 0
    const t = { value: dropAt }
    const runner = makeRunner(t)
    runner.onSignalingDrop()
    runner.endUnverifiedForcing(true, 500_000)
    assert.equal(runner.hasPostSettleSilentOpenWatch(), true)
    t.value = dropAt + FORCE_SIGNAL_VERIFY_CADENCE_MS
    let forced = false
    const peer = {
      destroyed: false,
      disconnected: false,
      open: true,
      disconnect: () => {},
      reconnect: () => { forced = true },
      signalReadyState: () => WS_OPEN,
      signalPeerOpenAt: () => t.value - 2000,
    }
    runner.tick(peer, true, false, true, false)
    assert.equal(forced, false)
    assert.equal(runner.hasPostSettleSilentOpenWatch(), false)
    runner.tick(peer, true, false, false, false)
    assert.equal(forced, false)
    runner.stop()
  })

  it('post-settle silent watch stops at reclaim max deadline', () => {
    const dropAt = 0
    const until = dropAt + 120_000
    const t = { value: until }
    const runner = makeRunner(t)
    runner.onSignalingDrop()
    runner.endUnverifiedForcing(true, until)
    const peer = {
      destroyed: false,
      disconnected: false,
      open: true,
      disconnect: () => {},
      reconnect: () => {},
      signalReadyState: () => WS_OPEN,
      signalPeerOpenAt: () => dropAt,
    }
    runner.tick(peer, true, false, false, false)
    assert.equal(runner.hasPostSettleSilentOpenWatch(), false)
    runner.stop()
  })

  it('defers post-settle cadence while incoming remember auth is pending', () => {
    const t = { value: 0 }
    const peer = makeMockPeer()
    peer.open = true
    peer.disconnected = false
    const peerExt = {
      ...peer,
      signalReadyState: () => WS_OPEN,
      signalPeerOpenAt: () => 0,
    }
    const runner = makeRunner(t)
    runner.onSignalingDrop()
    runner.endUnverifiedForcing(true)
    t.value = FORCE_SIGNAL_VERIFY_CADENCE_MS
    const before = peer.sockets.length
    runner.tick(peerExt, true, false, false, false, () => true)
    assert.equal(peer.sockets.length, before)
    runner.tick(peerExt, true, false, false, false, () => false)
    assert.ok(peer.sockets.length > before)
    runner.stop()
  })
})
