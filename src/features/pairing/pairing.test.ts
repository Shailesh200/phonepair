import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CODE_ALPHABET, isValidPairCode, normalizePairCode } from './code.ts'
import {
  classifyGuestPairError,
  guestErrorText,
  guestFailFastOnPeerUnavailable,
  MSG_CODE_EXPIRED,
  MSG_CODE_MISMATCH,
  MSG_HOST_NOT_FOUND,
} from './errors.ts'
import { fetchTurnPayload, TURN_FETCH_MS } from './turnFetch.ts'
import { buildRtcConfiguration, mergeIceServers } from './peerConfig.ts'
import { joinPathFor, withRelayQuery } from './relay.ts'
import { redialDelayMs } from './reconnect.ts'
import { phoneHostLabel } from './session.ts'
import {
  dialOpenTimeoutMs,
  GUEST_CONNECTING_WATCHDOG_MS,
  guestDialInFlight,
  guestShouldRedialOnPeerOpen,
  guestWatchdogShouldRedial,
  reopenListenerShouldDial,
  shouldDeferDialUntilPeerOpen,
} from './dialGuard.ts'

describe('pair code', () => {
  it('normalizes pasted spacing and dashes', () => {
    assert.equal(normalizePairCode('ab-c2 345'), 'ABC234')
    assert.equal(normalizePairCode('io01zz'), 'ZZ')
  })

  it('rejects disallowed letters in valid check', () => {
    assert.equal(isValidPairCode('ABC12I'), false)
    assert.equal(isValidPairCode('ABCDE0'), false)
    assert.equal(isValidPairCode('ABCDEF'), true)
    assert.equal(CODE_ALPHABET.includes('I'), false)
    assert.equal(CODE_ALPHABET.includes('2'), true)
  })
})

describe('phone host label', () => {
  it('shows Connecting… until remoteName arrives', () => {
    assert.equal(phoneHostLabel('', 'ABCDEF'), 'Connecting…')
    assert.equal(phoneHostLabel('Mac', 'ABCDEF'), 'Mac')
  })
})

describe('relay join paths', () => {
  it('join path keeps ?relay=1', () => {
    assert.equal(joinPathFor('ABC234', true), '/j/ABC234?relay=1')
    assert.equal(joinPathFor('ab-c234', true), '/j/ABC234?relay=1')
    assert.equal(joinPathFor('ABCDEF', false), '/j/ABCDEF')
  })

  it('withRelayQuery preserves relay on entry and host routes', () => {
    assert.equal(withRelayQuery('/', true), '/?relay=1')
    assert.equal(withRelayQuery('/?as=host', true), '/?as=host&relay=1')
    assert.equal(withRelayQuery('/j/CODE?relay=1', true), '/j/CODE?relay=1')
  })
})

describe('dial guard', () => {
  it('defers dial when the peer socket is disconnected', () => {
    assert.equal(
      shouldDeferDialUntilPeerOpen({ hasPeer: true, destroyed: false, disconnected: true }),
      true,
    )
    assert.equal(
      shouldDeferDialUntilPeerOpen({ hasPeer: true, destroyed: false, disconnected: false }),
      false,
    )
  })

  it('redials guest on peer open while connecting', () => {
    assert.equal(guestShouldRedialOnPeerOpen('guest', 'connecting', false), true)
    assert.equal(guestShouldRedialOnPeerOpen('guest', 'connected', true), false)
    assert.equal(guestShouldRedialOnPeerOpen('host', 'connecting', false), false)
  })

  it('dials only from the main open handler on reconnect', () => {
    assert.equal(reopenListenerShouldDial(), false)
    assert.equal(guestShouldRedialOnPeerOpen('guest', 'connecting', false), true)
  })

  it('allows only one in-flight guest dial window', () => {
    const now = 1_000_000
    assert.equal(guestDialInFlight(now + 5000, now), true)
    assert.equal(guestDialInFlight(now - 1, now), false)
  })

  it('uses longer dial timeout in relay mode', () => {
    assert.equal(dialOpenTimeoutMs(false), 12_000)
    assert.equal(dialOpenTimeoutMs(true), 25_000)
  })

  it('does not redial from the watchdog while a dial is still in flight at 15s', () => {
    assert.equal(guestWatchdogShouldRedial(true, GUEST_CONNECTING_WATCHDOG_MS), false)
    assert.equal(guestWatchdogShouldRedial(true, GUEST_CONNECTING_WATCHDOG_MS + 5000), false)
    assert.equal(guestWatchdogShouldRedial(false, GUEST_CONNECTING_WATCHDOG_MS), true)
    assert.equal(guestWatchdogShouldRedial(false, GUEST_CONNECTING_WATCHDOG_MS - 1), false)
  })
})

describe('redial backoff', () => {
  it('does not delay the first guest dial retries before first connect', () => {
    assert.equal(redialDelayMs(0, false), 0)
    assert.equal(redialDelayMs(1, false), 0)
    assert.ok(redialDelayMs(2, false) > 0)
  })
})

describe('guest errors', () => {
  it('fails fast on peer-unavailable for first-time guest dial', () => {
    assert.equal(guestFailFastOnPeerUnavailable('guest', false), true)
    assert.equal(guestFailFastOnPeerUnavailable('guest', true), false)
    assert.match(MSG_HOST_NOT_FOUND, /Couldn't find that code/)
  })
  it('uses mismatch copy by default', () => {
    const r = classifyGuestPairError({ code: 'ABCDEF', everConnectedThisSession: false, previouslyPairedCode: null })
    assert.equal(guestErrorText(r), MSG_CODE_MISMATCH)
  })

  it('uses expired when code was paired before', () => {
    const r = classifyGuestPairError({ code: 'ABCDEF', everConnectedThisSession: false, previouslyPairedCode: 'ABCDEF' })
    assert.equal(guestErrorText(r), MSG_CODE_EXPIRED)
  })
})

describe('turn / ice', () => {
  it('defaults to all transports', () => {
    const cfg = buildRtcConfiguration([{ urls: 'stun:x' }], false)
    assert.equal(cfg.iceTransportPolicy, 'all')
    assert.deepEqual(cfg.iceServers, [{ urls: 'stun:x' }])
  })

  it('forces relay when requested', () => {
    const cfg = buildRtcConfiguration([{ urls: 'turn:x' }], true)
    assert.equal(cfg.iceTransportPolicy, 'relay')
  })

  it('falls back to default STUN when turn payload empty', () => {
    assert.equal(mergeIceServers({}).length, 1)
    assert.match(String(mergeIceServers({})[0].urls), /stun/)
  })

  it(`abandons slow /api/turn after ${TURN_FETCH_MS}ms`, async () => {
    const slow = () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, json: async () => ({ iceServers: [] }) }), 10_000))
    const t0 = Date.now()
    const payload = await fetchTurnPayload(slow as typeof fetch, 80)
    assert.equal(payload, null)
    assert.ok(Date.now() - t0 < 500)
  })
})
