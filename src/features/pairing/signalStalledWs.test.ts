import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { WS_CONNECTING } from './forceSignalPeerState.ts'
import { SIGNAL_FRESH_CONNECTING_GRACE_MS } from './forceSignalReconnect.ts'
import {
  shouldKillFreshConnectingStalledAfterRestore,
  shouldKillStalledConnectingSocket,
  STALLED_SIGNAL_CONNECTING_AFTER_DROP_MS,
} from './signalStalledWs.ts'

describe('shouldKillStalledConnectingSocket', () => {
  it('replaces CONNECTING sockets stuck across a drop after ~3s', () => {
    const start = 1000
    const dropAt = 1100
    const peer = {
      destroyed: false,
      signalReadyState: () => WS_CONNECTING,
      signalConnectStartedAt: () => start,
      signalLastDropAt: () => dropAt,
    }
    assert.equal(shouldKillStalledConnectingSocket(peer, dropAt + 2999), false)
    assert.equal(shouldKillStalledConnectingSocket(peer, dropAt + 3000), true)
    assert.equal(STALLED_SIGNAL_CONNECTING_AFTER_DROP_MS, 3000)
  })

  it('kills a mid-cut CONNECTING socket as soon as restore is recorded', () => {
    const dropAt = 10_000
    const started = 15_000
    const restoreAt = 20_000
    const peer = {
      destroyed: false,
      signalReadyState: () => WS_CONNECTING,
      signalConnectStartedAt: () => started,
      signalLastDropAt: () => dropAt,
    }
    assert.equal(shouldKillStalledConnectingSocket(peer, restoreAt - 1, undefined, restoreAt), false)
    assert.equal(shouldKillStalledConnectingSocket(peer, restoreAt, undefined, restoreAt), true)
  })

  it('does not stalled-kill a listen socket that started after restore', () => {
    const restoreAt = 20_000
    const started = 21_000
    const peer = {
      destroyed: false,
      signalReadyState: () => WS_CONNECTING,
      signalConnectStartedAt: () => started,
      signalLastDropAt: () => 10_000,
    }
    assert.equal(shouldKillStalledConnectingSocket(peer, restoreAt + 10_000, undefined, restoreAt), false)
  })

  it('kills post-restore CONNECTING stuck longer than fresh-connecting grace', () => {
    const restoreAt = 20_000
    const started = 21_000
    const peer = {
      destroyed: false,
      signalReadyState: () => WS_CONNECTING,
      signalConnectStartedAt: () => started,
      signalLastDropAt: () => 10_000,
    }
    assert.equal(
      shouldKillFreshConnectingStalledAfterRestore(peer, started + SIGNAL_FRESH_CONNECTING_GRACE_MS - 1, restoreAt),
      false,
    )
    assert.equal(
      shouldKillFreshConnectingStalledAfterRestore(peer, started + SIGNAL_FRESH_CONNECTING_GRACE_MS, restoreAt),
      true,
    )
  })

  it('does not kill young CONNECTING sockets with no drop since create', () => {
    const peer = {
      destroyed: false,
      signalReadyState: () => WS_CONNECTING,
      signalConnectStartedAt: () => 5000,
      signalLastDropAt: () => null,
    }
    assert.equal(shouldKillStalledConnectingSocket(peer, 9000), false)
  })
})
