import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  listenForceTickAllowed,
  shouldInhibitHostCodePeerForce,
} from './hostRememberListenPriority.ts'

describe('host remember listen priority', () => {
  it('inhibits code peer force when remember phones exist', () => {
    assert.equal(shouldInhibitHostCodePeerForce(true), true)
    assert.equal(shouldInhibitHostCodePeerForce(false), false)
  })

  it('allows listen tick while unverified even before first open on a new socket', () => {
    assert.equal(listenForceTickAllowed(false, true), true)
    assert.equal(listenForceTickAllowed(true, false), true)
    assert.equal(listenForceTickAllowed(false, false), false)
  })
})
