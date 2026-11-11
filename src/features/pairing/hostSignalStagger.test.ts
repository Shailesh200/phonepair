import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HOST_LISTEN_FORCE_STAGGER_MS, shouldDeferListenForce } from './hostSignalStagger.ts'

describe('host signal stagger', () => {
  it('defers listen force until code peer opens or stagger elapses', () => {
    const until = 5000
    assert.equal(shouldDeferListenForce(false, until, until - 1), true)
    assert.equal(shouldDeferListenForce(false, until, until), false)
    assert.equal(shouldDeferListenForce(true, until, until - 1), false)
    assert.equal(HOST_LISTEN_FORCE_STAGGER_MS, 2000)
  })
})
