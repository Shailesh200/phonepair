import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hostAcceptsAnotherPhone } from './limit.ts'

describe('phones on one code', () => {
  it('lets the laptop keep up to three phones', () => {
    assert.equal(hostAcceptsAnotherPhone(0), true)
    assert.equal(hostAcceptsAnotherPhone(2), true)
    assert.equal(hostAcceptsAnotherPhone(3), false)
  })
})
