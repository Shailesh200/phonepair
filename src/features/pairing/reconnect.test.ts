import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  GUEST_REDIAL_MAX_MS_EVER_CONNECTED,
  GUEST_UNAVAILABLE_RETRY_MIN_MS,
  guestRedialPlanAfterSignalRecovery,
  guestUnavailableShouldGiveUp,
  redialDelayMs,
} from './reconnect.ts'

describe('redialDelayMs after everConnected', () => {
  it('caps guest backoff at 3s once paired', () => {
    assert.equal(redialDelayMs(0, true), 0)
    assert.ok(redialDelayMs(5, true) <= GUEST_REDIAL_MAX_MS_EVER_CONNECTED)
    assert.ok(redialDelayMs(20, true) <= GUEST_REDIAL_MAX_MS_EVER_CONNECTED)
    assert.equal(redialDelayMs(20, true), GUEST_REDIAL_MAX_MS_EVER_CONNECTED)
  })

  it('still allows zero-delay first dials before first connect', () => {
    assert.equal(redialDelayMs(0, false), 0)
    assert.equal(redialDelayMs(1, false), 0)
  })
})

describe('guestUnavailableShouldGiveUp', () => {
  const t0 = 1_000_000

  it('keeps retrying for at least 5 minutes after everConnected', () => {
    assert.equal(guestUnavailableShouldGiveUp(true, 50, t0, t0 + 60_000), false)
    assert.equal(guestUnavailableShouldGiveUp(true, 50, t0, t0 + GUEST_UNAVAILABLE_RETRY_MIN_MS - 1), false)
    assert.equal(guestUnavailableShouldGiveUp(true, 50, t0, t0 + GUEST_UNAVAILABLE_RETRY_MIN_MS), true)
  })

  it('uses attempt cap only on first pairing', () => {
    assert.equal(guestUnavailableShouldGiveUp(false, 6, null, t0), false)
    assert.equal(guestUnavailableShouldGiveUp(false, 7, null, t0), true)
  })
})

describe('guestRedialPlanAfterSignalRecovery', () => {
  it('resets backoff and dials immediately on signal recovery', () => {
    assert.deepEqual(guestRedialPlanAfterSignalRecovery(true), { retry: 0, delayMs: 0 })
    assert.deepEqual(guestRedialPlanAfterSignalRecovery(false), { retry: 0, delayMs: 0 })
  })
})
