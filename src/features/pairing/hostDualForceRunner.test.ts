import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ForceSignalRunner, FORCE_SIGNAL_VERIFY_CADENCE_MS } from './forceSignalReconnect.ts'
import { notifyHostPhoneConnected } from './hostDualForceRunner.ts'

function makeRunner(now: { value: number }) {
  return new ForceSignalRunner({
    setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => { if (id != null) clearTimeout(id) },
    now: () => now.value,
  })
}

function mockPeer() {
  let sockets = 1
  return {
    destroyed: false,
    disconnected: false,
    open: true,
    disconnect() {
      this.disconnected = true
      this.open = false
    },
    reconnect() {
      this.disconnected = false
      sockets += 1
    },
    sockets,
  }
}

describe('host dual force runner', () => {
  it('marks both runners unverified on drop', () => {
    const t = { value: 0 }
    const listen = makeRunner(t)
    const code = makeRunner(t)
    listen.onSignalingDrop()
    code.onSignalingDrop()
    assert.equal(listen.isUnverifiedAfterDrop(), true)
    assert.equal(code.isUnverifiedAfterDrop(), true)
    listen.stop()
    code.stop()
  })

  it('clears both runners after phone connect via listen peer', () => {
    const t = { value: 0 }
    const listen = makeRunner(t)
    const code = makeRunner(t)
    const peer = mockPeer()
    listen.onSignalingDrop()
    code.onSignalingDrop()
    notifyHostPhoneConnected(listen, code)
    assert.equal(listen.isUnverifiedAfterDrop(), false)
    assert.equal(code.isUnverifiedAfterDrop(), false)
    const before = peer.sockets
    t.value += FORCE_SIGNAL_VERIFY_CADENCE_MS
    listen.tick(peer, true, false, true, true)
    code.tick(peer, true, false, true, true)
    assert.equal(peer.sockets, before)
    listen.stop()
    code.stop()
  })

  it('clears both runners after phone connect via code peer', () => {
    const t = { value: 0 }
    const listen = makeRunner(t)
    const code = makeRunner(t)
    const peer = mockPeer()
    listen.onSignalingDrop()
    code.onSignalingDrop()
    notifyHostPhoneConnected(listen, code)
    assert.equal(listen.isUnverifiedAfterDrop(), false)
    assert.equal(code.isUnverifiedAfterDrop(), false)
    const before = peer.sockets
    code.tick(peer, true, false, true, true)
    listen.tick(peer, true, false, true, true)
    assert.equal(peer.sockets, before)
    listen.stop()
    code.stop()
  })
})
