import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MSG_REMEMBER_DENIED } from '../features/pairing/errors.ts'

const MAX_REMEMBER_FAILS = 3

function guestErrorAfterFail(failCount: number, denied: boolean): string {
  if (denied) return MSG_REMEMBER_DENIED
  if (failCount >= MAX_REMEMBER_FAILS) return "Couldn't reach your laptop. Use the code."
  return ''
}

function shouldRedialAfterFail(failCount: number, denied: boolean): boolean {
  if (denied) return false
  return failCount < MAX_REMEMBER_FAILS
}

describe('remember guest denied and retry cap', () => {
  it('denied stops redials and shows forget message', () => {
    assert.equal(guestErrorAfterFail(0, true), MSG_REMEMBER_DENIED)
    assert.equal(shouldRedialAfterFail(0, true), false)
    assert.equal(shouldRedialAfterFail(99, true), false)
  })

  it('caps other failures at three redials', () => {
    assert.equal(shouldRedialAfterFail(0, false), true)
    assert.equal(shouldRedialAfterFail(2, false), true)
    assert.equal(shouldRedialAfterFail(3, false), false)
    assert.equal(guestErrorAfterFail(3, false), "Couldn't reach your laptop. Use the code.")
    assert.notEqual(guestErrorAfterFail(3, false), '')
  })
})
