import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  guestRememberIncomingAuthAction,
  guestRememberKeepLiveOnAuthFail,
  guestRememberSwapOnPromote,
} from './guestRememberConn.ts'

describe('guest remember conn while live', () => {
  it('begins auth on a new conn without requiring the live conn to close first', () => {
    assert.equal(guestRememberIncomingAuthAction(true, false), 'begin-auth')
  })

  it('rejects a duplicate auth while one is pending', () => {
    assert.equal(guestRememberIncomingAuthAction(true, true), 'reject-incoming')
  })

  it('swaps only after mutual auth on the new conn', () => {
    assert.equal(guestRememberSwapOnPromote(true, false, true), 'swap')
    assert.equal(guestRememberSwapOnPromote(true, false, false), 'reject-new')
    assert.equal(guestRememberSwapOnPromote(false, false, true), 'noop')
  })

  it('keeps the live conn when pending auth fails', () => {
    assert.equal(guestRememberKeepLiveOnAuthFail(true), true)
    assert.equal(guestRememberKeepLiveOnAuthFail(false), false)
  })
})
