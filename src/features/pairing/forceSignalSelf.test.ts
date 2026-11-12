import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { markPeerForceDisconnect, takePeerForceDisconnect } from './forceSignalSelf.ts'

describe('force signal self-disconnect', () => {
  it('marks and consumes one pending force disconnect per peer', () => {
    const peer = {}
    assert.equal(takePeerForceDisconnect(peer), false)
    markPeerForceDisconnect(peer)
    assert.equal(takePeerForceDisconnect(peer), true)
    assert.equal(takePeerForceDisconnect(peer), false)
  })
})
