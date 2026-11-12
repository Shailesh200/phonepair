import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  GUEST_LISTEN_RECOVERY_PEER_UNAVAILABLE_CAP_MS,
  GUEST_LISTEN_RECOVERY_PROMPT_FIRST_ATTEMPTS,
  GUEST_REDIAL_MAX_MS_EVER_CONNECTED,
  GUEST_UNAVAILABLE_RETRY_MIN_MS,
  guestRedialPlanAfterSignalRecovery,
  guestShouldPromptRedialPeerUnavailableDuringListenRecovery,
  guestUnavailableShouldGiveUp,
  redialDelayAfterPeerUnavailable,
  redialDelayMs,
} from './reconnect.ts'
import { guestFailFastOnPeerUnavailable } from './errors.ts'

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

describe('redialDelayAfterPeerUnavailable', () => {
  it('spaces repeat peer-unavailable redials while keeping the 3s cap', () => {
    assert.equal(redialDelayAfterPeerUnavailable(1, true), 0)
    assert.ok(redialDelayAfterPeerUnavailable(2, true) > 0)
    assert.equal(redialDelayAfterPeerUnavailable(20, true), GUEST_REDIAL_MAX_MS_EVER_CONNECTED)
  })
})

describe('guestRedialPlanAfterSignalRecovery', () => {
  it('resets backoff and dials immediately on signal recovery', () => {
    assert.deepEqual(guestRedialPlanAfterSignalRecovery(true), { retry: 0, delayMs: 0 })
    assert.deepEqual(guestRedialPlanAfterSignalRecovery(false), { retry: 0, delayMs: 0 })
  })
})

describe('guest peer-unavailable during listen recovery', () => {
  const t0 = 2_000_000
  const base = {
    role: 'guest' as const,
    everConnected: true,
    rememberDial: true,
    peerOpen: true,
    peerDisconnected: false,
    hasInFlightDial: false,
    nextAttempt: 2,
    unavailableSince: t0 as number | null,
    now: t0 + 5000,
  }

  it('fresh pair with wrong code still fails fast (no prompt redial path)', () => {
    assert.equal(guestFailFastOnPeerUnavailable('guest', false), true)
    assert.equal(
      guestShouldPromptRedialPeerUnavailableDuringListenRecovery({
        ...base,
        everConnected: false,
        rememberDial: false,
        nextAttempt: 1,
      }),
      false,
    )
  })

  it('everConnected remember dial: fast path for first few attempts', () => {
    assert.equal(
      guestShouldPromptRedialPeerUnavailableDuringListenRecovery({
        ...base,
        nextAttempt: GUEST_LISTEN_RECOVERY_PROMPT_FIRST_ATTEMPTS,
        unavailableSince: null,
      }),
      true,
    )
    assert.equal(
      guestShouldPromptRedialPeerUnavailableDuringListenRecovery({
        ...base,
        nextAttempt: GUEST_LISTEN_RECOVERY_PROMPT_FIRST_ATTEMPTS + 1,
      }),
      true,
    )
  })

  it('streak backoff applies in recovery (capped delay, not zeroed)', () => {
    assert.equal(redialDelayAfterPeerUnavailable(1, true, GUEST_LISTEN_RECOVERY_PEER_UNAVAILABLE_CAP_MS), 0)
    assert.ok(redialDelayAfterPeerUnavailable(2, true, GUEST_LISTEN_RECOVERY_PEER_UNAVAILABLE_CAP_MS) > 0)
    const delay = redialDelayAfterPeerUnavailable(30, true, GUEST_LISTEN_RECOVERY_PEER_UNAVAILABLE_CAP_MS)
    assert.ok(delay > 0)
    assert.ok(delay <= GUEST_LISTEN_RECOVERY_PEER_UNAVAILABLE_CAP_MS)
  })

  it('permanently missing host exits fast path and reaches give-up', () => {
    const unavailableSince = t0
    const attempt = 20
    assert.equal(
      guestShouldPromptRedialPeerUnavailableDuringListenRecovery({
        ...base,
        nextAttempt: attempt,
        unavailableSince,
        now: unavailableSince + GUEST_UNAVAILABLE_RETRY_MIN_MS + 1,
      }),
      false,
    )
    assert.equal(
      guestUnavailableShouldGiveUp(true, attempt, unavailableSince, unavailableSince + GUEST_UNAVAILABLE_RETRY_MIN_MS),
      true,
    )
  })
})
