import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  REMEMBER_AUTH_PENDING_SUPERSEDE_MS,
  authPendingBlocksAccept,
  mainConnBlocksRememberAccept,
  rememberAcceptAllowed,
} from './hostAuthAccept.ts'

describe('remember host auth accept', () => {
  it('supersedes auth pending older than 3s', () => {
    const now = 10_000
    const v = rememberAcceptAllowed({
      now,
      backoffUntil: 0,
      hasPending: true,
      pendingStartedAt: now - REMEMBER_AUTH_PENDING_SUPERSEDE_MS,
      mainConnOpen: false,
    })
    assert.equal(v.accept, true)
    assert.equal(v.supersedePending, true)
    assert.equal(authPendingBlocksAccept(true, REMEMBER_AUTH_PENDING_SUPERSEDE_MS - 1), true)
    assert.equal(authPendingBlocksAccept(true, REMEMBER_AUTH_PENDING_SUPERSEDE_MS), false)
  })

  it('does not apply backoff to timeout-only paths via accept', () => {
    const v = rememberAcceptAllowed({
      now: 1000,
      backoffUntil: 2000,
      hasPending: false,
      pendingStartedAt: null,
      mainConnOpen: false,
    })
    assert.equal(v.accept, false)
    assert.equal(v.reject, 'backoff')
  })

  it('allows same phoneId when main conn is open', () => {
    assert.equal(mainConnBlocksRememberAccept(true, 'phone-a', 'phone-a'), false)
    assert.equal(mainConnBlocksRememberAccept(true, 'phone-a', 'phone-b'), true)
    assert.equal(mainConnBlocksRememberAccept(true, undefined, 'phone-a'), false)
  })
})
