import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { listenMustDestroyBeforeNewPeer, planListenBootstrapPeer } from './rememberListenBootstrap.ts'

describe('planListenBootstrapPeer', () => {
  it('reconnects an existing disconnected listen peer instead of rotating', () => {
    assert.equal(
      planListenBootstrapPeer({ destroyed: false, open: false, disconnected: true }),
      'reconnect-existing',
    )
    assert.equal(
      planListenBootstrapPeer({ destroyed: false, open: true, disconnected: true }),
      'reconnect-existing',
    )
  })

  it('skips when the listen peer is already open', () => {
    assert.equal(
      planListenBootstrapPeer({ destroyed: false, open: true, disconnected: false }),
      'skip-open',
    )
  })

  it('creates a new peer only when missing or destroyed', () => {
    assert.equal(planListenBootstrapPeer(null), 'create-new')
    assert.equal(
      planListenBootstrapPeer({ destroyed: true, open: false, disconnected: false }),
      'create-new',
    )
  })

  it('requires destroying a live previous peer before constructing a new one', () => {
    const live = planListenBootstrapPeer({ destroyed: false, open: false, disconnected: true })
    assert.equal(live, 'reconnect-existing')
    assert.equal(listenMustDestroyBeforeNewPeer(live), false)
    const create = planListenBootstrapPeer(null)
    assert.equal(listenMustDestroyBeforeNewPeer(create), true)
  })
})
