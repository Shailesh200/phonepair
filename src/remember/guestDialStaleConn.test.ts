import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { guestRememberDialShouldClearOpenConn } from './guestDialStaleConn.ts'

describe('guest remember dial stale conn', () => {
  const base = {
    rememberGuest: true,
    status: 'reconnecting' as const,
    everConnected: true,
    dataConnOpen: true,
    lastSeen: 100_000,
    now: 101_000,
  }

  it('clears an open conn when ICE is not healthy', () => {
    assert.equal(guestRememberDialShouldClearOpenConn({ ...base, iceState: 'disconnected' }), true)
    assert.equal(guestRememberDialShouldClearOpenConn({ ...base, iceState: 'connected' }), false)
  })

  it('ignores when already connected on a healthy session', () => {
    assert.equal(
      guestRememberDialShouldClearOpenConn({ ...base, status: 'connected', iceState: 'disconnected' }),
      false,
    )
  })
})
