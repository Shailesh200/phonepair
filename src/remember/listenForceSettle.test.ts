import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { listenForceRecycleDeferred } from './listenForceSettle.ts'

describe('listen force settle', () => {
  it('defers recycle while listen is open during settle window', () => {
    const now = 10_000
    assert.equal(listenForceRecycleDeferred(true, false, now + 5000, now), true)
    assert.equal(listenForceRecycleDeferred(true, false, now + 5000, now + 4000), true)
    assert.equal(listenForceRecycleDeferred(true, false, now + 5000, now + 6000), false)
    assert.equal(listenForceRecycleDeferred(false, false, now + 5000, now), false)
    assert.equal(listenForceRecycleDeferred(true, true, now + 5000, now), false)
  })
})
