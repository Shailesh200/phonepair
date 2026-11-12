import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hmacSha256, verifyHmac } from './crypto.ts'
import { randomBytes } from './ids.ts'
import {
  gateAllowsFeatureData,
  gateMessageDisposition,
  gateAfterValidProof,
  gateOnAuthFailure,
} from './gate.ts'
import { shouldRestartListenPeer } from './allowListen.ts'
import { rememberStorageEpoch, notifyRememberStorageChanged } from './storageNotify.ts'
import { shouldTickBootstrapListen } from './listenGiveUp.ts'
import { hostRememberListenOtherTab } from './rememberOtherTab.ts'
import { shouldHostArmListenIdRecovery } from './rememberListenRecoveryGate.ts'
import { guestForgetMatchesSavedLaptop } from './guestForgetMatch.ts'
import { shouldFailRememberGuestHome } from './guestHomeWatchdog.ts'
import { rememberGuestDeadlineArm, rememberGuestDeadlineApplies, REMEMBER_GUEST_HOME_MS } from './rememberGuestDeadline.ts'
import {
  listenClaimShouldGiveUp,
  listenReclaimIdBackoffMs,
  shouldRearmListenPeer,
  LISTEN_ID_RECLAIM_MIN_MS,
} from './listenIdReclaim.ts'
import { hostAcceptsPhoneForget } from './hostForgetInbound.ts'
import { guestForgetShouldSync } from './guestForgetSync.ts'
import { connBlockedByRememberAuth } from './hostAuthSend.ts'
import { phoneShowsConnecting, phoneShowsPairedHome } from './guestSessionGate.ts'
import {
  canOpenRememberListenSocket,
  listenClaimGiveUp,
  REMEMBER_LISTEN_MAX_SOCKETS,
  REMEMBER_LISTEN_UNAVAILABLE_GIVE_UP,
} from './rememberListenClaim.ts'
import { routeRememberDeniedToEntry } from './guestDeniedUi.ts'
import { MSG_REMEMBER_DENIED } from '../features/pairing/errors.ts'
import { forgetHostPhoneRecord, upsertGuestLaptop, type HostStore } from './records.ts'

describe('remember hmac', () => {
  it('accepts the right key and rejects a wrong key or tampered nonce', async () => {
    const key = randomBytes(32)
    const wrong = randomBytes(32)
    const nonce = randomBytes(32)
    const proof = await hmacSha256(key, nonce)
    assert.equal(await verifyHmac(key, nonce, proof), true)
    assert.equal(await verifyHmac(wrong, nonce, proof), false)
    const tampered = new Uint8Array(nonce)
    tampered[0] ^= 0xff
    assert.equal(await verifyHmac(key, tampered, proof), false)
  })
})

describe('remember session gate', () => {
  it('drops feature traffic before proof and allows it after a valid proof', () => {
    assert.equal(gateAllowsFeatureData('await-proof'), false)
    assert.equal(gateMessageDisposition('await-proof', 'file:ping'), 'drop')
    assert.equal(gateMessageDisposition('await-proof', 'remember:proof'), 'control')
    assert.equal(gateAllowsFeatureData(gateAfterValidProof('await-proof')), true)
    assert.equal(gateAllowsFeatureData(gateOnAuthFailure('await-proof')), false)
  })
})

describe('remember guest storage v1', () => {
  it('keeps at most one saved laptop, replacing any prior entry', () => {
    const a = { listenId: 'a', phoneId: 'p1', name: 'Laptop A', key: 'ka' }
    const b = { listenId: 'b', phoneId: 'p1', name: 'Laptop B', key: 'kb' }
    const first = upsertGuestLaptop({ laptops: [] }, a)
    assert.equal(first.laptops.length, 1)
    const second = upsertGuestLaptop(first, b)
    assert.equal(second.laptops.length, 1)
    assert.equal(second.laptops[0].listenId, 'b')
  })
})

describe('remember listen give up', () => {
  const base = { hasPhones: true, listenMissing: true, listenGaveUp: false, bootstrapInFlight: false, backoffUntil: 0, now: 1000 }
  it('does not tick-bootstrap listen after unavailable-id give-up or during backoff', () => {
    assert.equal(shouldTickBootstrapListen(base), true)
    assert.equal(shouldTickBootstrapListen({ ...base, listenGaveUp: true }), false)
    assert.equal(shouldTickBootstrapListen({ ...base, bootstrapInFlight: true }), false)
    assert.equal(shouldTickBootstrapListen({ ...base, backoffUntil: 2000 }), false)
    assert.equal(shouldTickBootstrapListen({ ...base, hasPhones: false }), false)
    assert.equal(shouldTickBootstrapListen({ ...base, listenMissing: false }), false)
  })
})

describe('remember other tab', () => {
  const store: HostStore = { listenId: 'l', phones: [{ id: 'p', name: 'Phone', key: 'k' }] }
  it('does not arm listen-id recovery on a tab that never owned the id', () => {
    assert.equal(
      shouldHostArmListenIdRecovery({
        hasRememberPhones: true,
        listenOwnedBefore: false,
        listenGaveUp: false,
      }),
      false,
    )
  })

  it('shows only after listen give-up with saved phones', () => {
    assert.equal(hostRememberListenOtherTab(false, store), false)
    assert.equal(hostRememberListenOtherTab(true, store), true)
    assert.equal(hostRememberListenOtherTab(true, null), false)
    assert.equal(hostRememberListenOtherTab(true, { listenId: 'l', phones: [] }), false)
  })
})

describe('remember guest session ui', () => {
  it('keeps home on paired reconnecting and connecting only before pair', () => {
    assert.equal(phoneShowsPairedHome(true, 'connected'), true)
    assert.equal(phoneShowsPairedHome(true, 'reconnecting'), true)
    assert.equal(phoneShowsPairedHome(false, 'connected'), false)
    assert.equal(phoneShowsPairedHome(false, 'reconnecting'), false)
    assert.equal(phoneShowsConnecting(false, 'reconnecting'), true)
    assert.equal(phoneShowsConnecting(true, 'reconnecting'), false)
    assert.equal(phoneShowsConnecting(false, 'connecting'), true)
  })
})

describe('remember listen claim', () => {
  it('gives up after two unavailable-id failures (burst cap uses unavailable-id only)', () => {
    assert.equal(listenClaimGiveUp(1, 1), false)
    assert.equal(listenClaimGiveUp(2, 1), true)
    assert.equal(listenClaimGiveUp(REMEMBER_LISTEN_UNAVAILABLE_GIVE_UP, 99), true)
    assert.equal(canOpenRememberListenSocket(false, [], 3000, false), true)
    assert.equal(canOpenRememberListenSocket(false, [1000, 2000, 3000], 4000, false), false)
    assert.equal(canOpenRememberListenSocket(true, [], 3000, false), false)
  })
})

describe('remember denied routing', () => {
  it('routes MSG_REMEMBER_DENIED to entry denied UI', () => {
    assert.equal(routeRememberDeniedToEntry(MSG_REMEMBER_DENIED), true)
    assert.equal(routeRememberDeniedToEntry('nope'), false)
  })
})

describe('remember guest home watchdog', () => {
  it('keeps redialing past 8s once the guest has authenticated', () => {
    const t0 = 1000
    const deadline = t0 + REMEMBER_GUEST_HOME_MS
    assert.equal(
      shouldFailRememberGuestHome({
        rememberGuest: true,
        sessionPaired: false,
        rememberEverAuthed: true,
        status: 'reconnecting',
        deadlineMs: deadline,
        now: deadline + 60_000,
      }),
      false,
    )
  })

  it('does not fail home after the guest has paired the session', () => {
    const t0 = 1000
    const deadline = t0 + REMEMBER_GUEST_HOME_MS
    assert.equal(shouldFailRememberGuestHome({
      rememberGuest: true,
      sessionPaired: true,
      status: 'reconnecting',
      deadlineMs: deadline,
      now: deadline + 1,
    }), false)
    assert.equal(shouldFailRememberGuestHome({
      rememberGuest: true,
      sessionPaired: false,
      status: 'connecting',
      deadlineMs: deadline,
      now: deadline + 1,
    }), true)
  })
})

describe('remember listen reclaim', () => {
  it('keeps retrying past two unavailable-id failures when the id was owned before', () => {
    const t0 = 0
    assert.equal(listenClaimGiveUp(2, 1), true)
    assert.equal(
      listenClaimShouldGiveUp(2, 1, true, t0, t0 + 10_000),
      false,
    )
    assert.equal(
      listenClaimShouldGiveUp(2, 1, true, t0, t0 + LISTEN_ID_RECLAIM_MIN_MS),
      true,
    )
    assert.equal(listenReclaimIdBackoffMs(5), 10_000)
  })

  it('still gives up at two failures on a first-ever listen claim', () => {
    assert.equal(listenClaimShouldGiveUp(2, 1, false, null, 0), true)
  })

  it('retries ID-TAKEN more than 75s after listen open (reclaim starts at failure not open)', () => {
    const failureAt = 80_000
    assert.equal(
      listenClaimShouldGiveUp(2, 1, true, failureAt, failureAt + 1000),
      false,
    )
    assert.equal(
      listenClaimShouldGiveUp(2, 1, true, failureAt, failureAt + LISTEN_ID_RECLAIM_MIN_MS),
      true,
    )
  })
})

describe('remember listen rearm', () => {
  it('re-arms while waiting with saved phones', () => {
    assert.equal(
      shouldRearmListenPeer({ role: 'host', hasPhones: true, status: 'waiting', listenMissingOrDead: false }),
      true,
    )
    assert.equal(
      shouldRearmListenPeer({ role: 'guest', hasPhones: true, status: 'waiting', listenMissingOrDead: true }),
      false,
    )
  })
})

describe('remember guest deadline', () => {
  it('does not apply after the guest has authenticated once', () => {
    assert.equal(rememberGuestDeadlineApplies(true, true, false), false)
    assert.equal(rememberGuestDeadlineApplies(true, false, false), true)
  })

  it('arms at tap time before any later config fetch', () => {
    const atTap = rememberGuestDeadlineArm(0, 100, REMEMBER_GUEST_HOME_MS)
    const afterFetch = rememberGuestDeadlineArm(atTap, 5000, REMEMBER_GUEST_HOME_MS)
    assert.equal(afterFetch, atTap)
    assert.equal(atTap, 100 + REMEMBER_GUEST_HOME_MS)
  })

  it('keeps the original 8s cap across a mid-window redial', () => {
    const t0 = 0
    const deadline = rememberGuestDeadlineArm(0, t0, REMEMBER_GUEST_HOME_MS)
    const atRedial = rememberGuestDeadlineArm(deadline, 5000, REMEMBER_GUEST_HOME_MS)
    assert.equal(atRedial, deadline)
    assert.equal(
      shouldFailRememberGuestHome({
        rememberGuest: true,
        sessionPaired: false,
        status: 'connecting',
        deadlineMs: deadline,
        now: 7999,
      }),
      false,
    )
    assert.equal(
      shouldFailRememberGuestHome({
        rememberGuest: true,
        sessionPaired: false,
        status: 'connecting',
        deadlineMs: deadline,
        now: 8000,
      }),
      true,
    )
  })
})

describe('remember host forget auth', () => {
  it('accepts forget on listen or code peer when listenId and phone match', () => {
    const base = {
      storeListenId: 'lid',
      msgListenId: 'lid',
      authenticatedPhoneId: 'p-a',
      phoneId: 'p-a',
      phoneKnown: true,
    }
    assert.equal(hostAcceptsPhoneForget({ ...base, fromListenPeer: true, fromCodePeer: false }), true)
    assert.equal(hostAcceptsPhoneForget({ ...base, fromListenPeer: false, fromCodePeer: true }), true)
    assert.equal(hostAcceptsPhoneForget({ ...base, fromListenPeer: false, fromCodePeer: false }), false)
    assert.equal(hostAcceptsPhoneForget({ ...base, fromListenPeer: true, fromCodePeer: false, phoneId: 'p-b' }), false)
    assert.equal(hostAcceptsPhoneForget({ ...base, fromListenPeer: true, fromCodePeer: false, phoneKnown: false }), false)
    assert.equal(hostAcceptsPhoneForget({ ...base, fromListenPeer: false, fromCodePeer: true, msgListenId: 'other' }), false)
  })
})

describe('remember guest forget sync', () => {
  const lap = { listenId: 'lid', phoneId: 'p1', name: 'Laptop', key: 'k' }
  it('syncs forget when remember-authed or single-laptop code pair', () => {
    assert.equal(guestForgetShouldSync(true, 'lid', false, lap, 1), true)
    assert.equal(guestForgetShouldSync(true, undefined, true, lap, 1), true)
    assert.equal(guestForgetShouldSync(false, 'lid', true, lap, 1), false)
    assert.equal(guestForgetShouldSync(true, 'other', true, lap, 2), false)
  })
})

describe('remember call gate', () => {
  it('blocks call only when this conn is the unproven auth conn', () => {
    const live = { open: true, peer: 'a' }
    const otherPending = { open: true, peer: 'b' }
    assert.equal(connBlockedByRememberAuth(live, otherPending, null), false)
    assert.equal(connBlockedByRememberAuth(live, live, null), true)
    assert.equal(connBlockedByRememberAuth(live, null, otherPending), false)
  })
})

describe('remember guest forget match', () => {
  it('ignores forget for another phoneId on the same listen slot', () => {
    const store = {
      laptops: [{ listenId: 'lid-a', phoneId: 'p-a', name: 'Laptop', key: 'k' }],
    }
    assert.equal(guestForgetMatchesSavedLaptop(store, 'lid-a', 'p-a'), true)
    assert.equal(guestForgetMatchesSavedLaptop(store, 'lid-a', 'p-b'), false)
    assert.equal(guestForgetMatchesSavedLaptop(store, 'lid-b', 'p-a'), false)
  })
})

describe('remember storage notify', () => {
  it('bumps epoch when storage changes', () => {
    const before = rememberStorageEpoch.get()
    notifyRememberStorageChanged()
    assert.equal(rememberStorageEpoch.get(), before + 1)
  })
})

describe('remember allowListen', () => {
  it('does not restart listen peer while conn is on it', () => {
    assert.equal(shouldRestartListenPeer(true), false)
    assert.equal(shouldRestartListenPeer(false), true)
  })
})

describe('remember forget', () => {
  it('removes a phone key and stops listen when the last phone is forgotten', () => {
    const store: HostStore = {
      listenId: 'abc',
      phones: [{ id: 'p1', name: 'Phone', key: 'aa' }],
    }
    const one = forgetHostPhoneRecord(store, 'p1')
    assert.equal(one.next, null)
    assert.equal(one.stopListen, true)

    const multi: HostStore = {
      listenId: 'abc',
      phones: [
        { id: 'p1', name: 'A', key: 'x' },
        { id: 'p2', name: 'B', key: 'y' },
      ],
    }
    const two = forgetHostPhoneRecord(multi, 'p1')
    assert.equal(two.stopListen, false)
    assert.equal(two.next?.phones.length, 1)
    assert.equal(two.next?.phones[0].id, 'p2')
  })
})
