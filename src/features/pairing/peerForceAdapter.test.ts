import { describe, it, mock, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type Peer from 'peerjs'
import { peerAsForceSignal } from './peerForceAdapter.ts'
import {
  ForceSignalRunner,
  FORCE_SIGNAL_OPEN_WATCHDOG_MS,
  forceSignalReconnect,
} from './forceSignalReconnect.ts'
import { WS_CONNECTING } from './forceSignalPeerState.ts'

function makePeerStub(opts?: { connectingSocket?: boolean }) {
  const state = {
    destroyed: false,
    disconnected: false,
    open: false,
    reconnects: 0,
  }
  const peer = {
    get destroyed() { return state.destroyed },
    get disconnected() { return state.disconnected },
    get open() { return state.open },
    disconnect() { state.disconnected = true; state.open = false },
    reconnect() { state.disconnected = false; state.reconnects += 1 },
    socket: opts?.connectingSocket
      ? { _socket: { readyState: WS_CONNECTING } }
      : undefined,
  }
  return { peer: peer as unknown as Peer, state }
}

function makeRunner(now: { value: number }) {
  return new ForceSignalRunner({
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => { if (id != null) clearTimeout(id) },
    now: () => now.value,
  })
}

describe('peerAsForceSignal live getters', () => {
  it('reads destroyed, disconnected, and open from the current peer', () => {
    const { peer, state } = makePeerStub()
    const wrapped = peerAsForceSignal(peer)
    assert.equal(wrapped.destroyed, false)
    assert.equal(wrapped.disconnected, false)
    assert.equal(wrapped.open, false)
    state.open = true
    assert.equal(wrapped.open, true)
    state.disconnected = true
    assert.equal(wrapped.disconnected, true)
    state.destroyed = true
    assert.equal(wrapped.destroyed, true)
  })
})

describe('force runner peer replacement', () => {
  afterEach(() => {
    mock.timers.reset()
  })

  it('rebindPeer stops the old chain; hook/cadence use the new peer', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const t = { value: 0 }
    const runner = makeRunner(t)
    const old = makePeerStub({ connectingSocket: true })
    const neu = makePeerStub()
    runner.onSignalingDrop()
    runner.hook(peerAsForceSignal(old.peer), false)
    assert.equal(runner.runnerBusy(), true)
    const oldReconnects = old.state.reconnects
    runner.rebindPeer()
    assert.equal(runner.runnerBusy(), false)
    runner.hook(peerAsForceSignal(neu.peer), false)
    assert.equal(neu.state.reconnects, 1)
    t.value += FORCE_SIGNAL_OPEN_WATCHDOG_MS + 5000
    mock.timers.tick(FORCE_SIGNAL_OPEN_WATCHDOG_MS + 5000)
    assert.equal(old.state.reconnects, oldReconnects)
    runner.stop()
  })

  it('forces the new peer immediately after rebind (not blocked by runnerBusy)', () => {
    const t = { value: 0 }
    const runner = makeRunner(t)
    const old = makePeerStub({ connectingSocket: true })
    const neu = makePeerStub()
    runner.hook(peerAsForceSignal(old.peer), false)
    assert.equal(runner.runnerBusy(), true)
    runner.rebindPeer()
    assert.equal(runner.runnerBusy(), false)
    runner.hook(peerAsForceSignal(neu.peer), false)
    assert.equal(neu.state.reconnects, 1)
    runner.stop()
  })

  it('destroy after hook() stops the whole chain', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    const t = { value: 0 }
    const runner = makeRunner(t)
    const { peer, state } = makePeerStub()
    runner.hook(peerAsForceSignal(peer), false)
    const afterHook = state.reconnects
    state.destroyed = true
    assert.equal(runner.runnerBusy(), true)
    t.value += 20_000
    mock.timers.tick(20_000)
    assert.equal(state.reconnects, afterHook)
    runner.stop()
  })
})

describe('forceSignalReconnect live peer state', () => {
  it('reads destroyed and disconnected at call time', () => {
    const { peer, state } = makePeerStub()
    const wrapped = peerAsForceSignal(peer)
    assert.equal(forceSignalReconnect(wrapped), true)
    state.destroyed = true
    assert.equal(forceSignalReconnect(wrapped), false)
    state.destroyed = false
    state.disconnected = true
    assert.equal(forceSignalReconnect(wrapped), true)
  })
})
