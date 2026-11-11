import { describe, it, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORCE_SIGNAL_OPEN_WATCHDOG_MS,
  ForceSignalRunner,
  forceSignalReconnect,
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

describe('forceSignalReconnect', () => {
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
    const now = 0
    let t = now
    const runner = new ForceSignalRunner({
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => { if (id != null) clearTimeout(id) },
      now: () => t,
    })
    runner.hook(peer, true)
    assert.equal(peer.sockets.length, 2)
    t += FORCE_SIGNAL_OPEN_WATCHDOG_MS
    mock.timers.tick(FORCE_SIGNAL_OPEN_WATCHDOG_MS)
    assert.ok(peer.sockets.length >= 2)
  })

  it('reaches open within 15s after a 20s cut when network returns (fake timers)', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const peer = makeMockPeer()
    let t = 0
    const runner = new ForceSignalRunner({
      setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      clearTimeout: (id) => { if (id != null) clearTimeout(id) },
      now: () => t,
    })
    t = 20_000
    runner.hook(peer, true)
    const openAt = () => {
      peer.open = true
      const s = peer._getSocket()
      if (s) s.readyState = WS_OPEN
      peer.sockets[peer.sockets.length - 1].readyState = WS_OPEN
      runner.onOpen()
    }
    const advance = (ms: number) => {
      t += ms
      mock.timers.tick(ms)
      if (!peer.open && peer.sockets.length > 1) openAt()
    }
    advance(3000)
    assert.equal(peer.open, true)
    assert.ok(t - 20_000 <= 15_000)
  })
})
