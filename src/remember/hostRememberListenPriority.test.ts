import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { listenForceTickAllowed } from './hostRememberListenPriority.ts'

describe('host remember listen priority', () => {
  it('allows listen tick while unverified even before first open on a new socket', () => {
    assert.equal(listenForceTickAllowed(false, true), true)
    assert.equal(listenForceTickAllowed(true, false), true)
    assert.equal(listenForceTickAllowed(false, false), false)
  })
})
