import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORCE_SOCKET_MIN_OPEN_MS,
  mayForceRecycleOpenSignalSocket,
  WS_OPEN,
} from './forceSignalPeerState.ts'

describe('signal restore recycle', () => {
  it('recycles an OPEN socket immediately on restore when it opened before the restore signal', () => {
    const openAt = 1000
    const restoreAt = 5000
    const now = openAt + 1000
    const peer = {
      destroyed: false,
      open: true,
      signalReadyState: () => WS_OPEN,
      signalPeerOpenAt: () => openAt,
      signalConnectStartedAt: () => openAt,
    }
    assert.ok(now - openAt < FORCE_SOCKET_MIN_OPEN_MS)
    assert.equal(
      mayForceRecycleOpenSignalSocket(peer, now, { mode: 'online', restoreSignalAt: restoreAt }),
      true,
    )
    assert.equal(
      mayForceRecycleOpenSignalSocket(peer, now, { mode: 'tick', restoreSignalAt: null }),
      false,
    )
  })
})
