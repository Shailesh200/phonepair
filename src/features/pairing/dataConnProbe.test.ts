import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DATA_CONN_PROBE_SKIP_RECENT_MS,
  DATA_CONN_PROBE_TIMEOUT_MS,
  buildLinkHelloMessage,
  dataConnProbeSucceeded,
  freshRemotePongCap,
  effectiveRemotePongCapForProbe,
  helloCapsIncludePong,
  isNewToNewProbeSession,
  shouldDispatchConnKeepalive,
  shouldMarkConnProbeEligible,
  shouldRunDataConnProbe,
} from './dataConnProbe.ts'

describe('buildLinkHelloMessage', () => {
  it('always uses local deviceName, never a remote hint', () => {
    const local = 'Guest Pixel'
    const remoteHint = 'Saved Laptop Name'
    const msg = buildLinkHelloMessage(local)
    assert.equal(msg.name, local)
    assert.notEqual(msg.name, remoteHint)
    assert.equal(msg.t, 'hello')
    assert.deepEqual(msg.caps, ['pong'])
  })
})

describe('remotePongCap lifecycle', () => {
  it('clears on drop and new conn so old peer without cap hello is never probed', () => {
    let cap = true
    cap = freshRemotePongCap()
    assert.equal(cap, false)
    assert.equal(
      shouldRunDataConnProbe({
        connOpen: true,
        localOffersPong: true,
        remoteSupportsPong: cap,
        probePending: false,
        lastSeen: 0,
        now: 10_000,
      }),
      false,
    )
    cap = true
    cap = freshRemotePongCap()
    assert.equal(
      shouldRunDataConnProbe({
        connOpen: true,
        localOffersPong: true,
        remoteSupportsPong: cap,
        probePending: false,
        lastSeen: 0,
        now: 10_000,
      }),
      false,
    )
  })

  it('phone with cap then drop: stale cap must not enable probe until new hello', () => {
    let remotePongCap = true
    remotePongCap = freshRemotePongCap()
    const probeAfterOldPhone = shouldRunDataConnProbe({
      connOpen: true,
      localOffersPong: true,
      remoteSupportsPong: remotePongCap,
      probePending: false,
      lastSeen: 0,
      now: 50_000,
    })
    assert.equal(probeAfterOldPhone, false)
    remotePongCap = helloCapsIncludePong(['pong'])
    assert.equal(
      shouldRunDataConnProbe({
        connOpen: true,
        localOffersPong: true,
        remoteSupportsPong: remotePongCap,
        probePending: false,
        lastSeen: 0,
        now: 50_000,
      }),
      true,
    )
  })
})

describe('shouldDispatchConnKeepalive', () => {
  it('ping/pong on open conn while guest reconnecting', () => {
    assert.equal(
      shouldDispatchConnKeepalive({
        connOpen: true,
        rememberGuestAuth: true,
        status: 'reconnecting',
        t: 'ping',
      }),
      true,
    )
    assert.equal(
      shouldDispatchConnKeepalive({
        connOpen: true,
        rememberGuestAuth: true,
        status: 'reconnecting',
        t: 'pong',
      }),
      true,
    )
    assert.equal(
      shouldDispatchConnKeepalive({
        connOpen: true,
        rememberGuestAuth: true,
        status: 'reconnecting',
        t: 'clip:set',
      }),
      false,
    )
  })

  it('host probe pong after probeAt counts as alive (no abandon)', () => {
    const probeAt = 10_000
    const lastSeenAfterPong = 10_001
    assert.equal(dataConnProbeSucceeded(lastSeenAfterPong, probeAt), true)
  })
})

describe('hello pong capability', () => {
  it('old hello without caps is not probed', () => {
    assert.equal(helloCapsIncludePong(undefined), false)
    assert.equal(helloCapsIncludePong([]), false)
    assert.equal(helloCapsIncludePong(['clip']), false)
    assert.equal(helloCapsIncludePong(['pong']), true)
  })
})

describe('new-to-new probe session', () => {
  const session = {
    everConnected: true,
    sessionPaired: true,
    rememberGuestAuth: false,
  }

  it('laptop (host) marks eligible and assumes remote pong before hello on restore', () => {
    assert.equal(shouldMarkConnProbeEligible({
      connOpen: true,
      connProbeEligible: false,
      ...session,
    }), true)
    assert.equal(effectiveRemotePongCapForProbe(false, session), true)
    assert.equal(
      shouldRunDataConnProbe({
        connOpen: true,
        localOffersPong: true,
        remoteSupportsPong: effectiveRemotePongCapForProbe(false, session),
        probePending: false,
        lastSeen: 0,
        now: 10_000,
      }),
      true,
    )
  })

  it('phone (guest) same policy on restore when conn stayed open', () => {
    assert.equal(isNewToNewProbeSession(session), true)
    assert.equal(shouldMarkConnProbeEligible({
      connOpen: true,
      connProbeEligible: false,
      ...session,
    }), true)
    assert.equal(
      shouldRunDataConnProbe({
        connOpen: true,
        localOffersPong: true,
        remoteSupportsPong: effectiveRemotePongCapForProbe(freshRemotePongCap(), session),
        probePending: false,
        lastSeen: 0,
        now: 10_000,
      }),
      true,
    )
  })

  it('remember-guest auth path still requires explicit remote pong cap', () => {
    const remember = { ...session, rememberGuestAuth: true }
    assert.equal(isNewToNewProbeSession(remember), false)
    assert.equal(shouldMarkConnProbeEligible({
      connOpen: true,
      connProbeEligible: false,
      ...remember,
    }), false)
    assert.equal(effectiveRemotePongCapForProbe(false, remember), false)
  })
})

describe('shouldRunDataConnProbe', () => {
  const base = {
    connOpen: true,
    localOffersPong: true,
    remoteSupportsPong: true,
    probePending: false,
    lastSeen: 0,
    now: 10_000,
  }

  it('never probes without remote pong capability', () => {
    assert.equal(shouldRunDataConnProbe({ ...base, remoteSupportsPong: false }), false)
  })

  it('skips when recent inbound data arrived within 2s', () => {
    assert.equal(
      shouldRunDataConnProbe({
        ...base,
        lastSeen: base.now - DATA_CONN_PROBE_SKIP_RECENT_MS + 1,
      }),
      false,
    )
    assert.equal(
      shouldRunDataConnProbe({
        ...base,
        lastSeen: base.now - DATA_CONN_PROBE_SKIP_RECENT_MS - 1,
      }),
      true,
    )
  })
})

describe('probe policy', () => {
  it('old peer without pong cap is never probed', () => {
    assert.equal(
      shouldRunDataConnProbe({
        connOpen: true,
        localOffersPong: true,
        remoteSupportsPong: false,
        probePending: false,
        lastSeen: 0,
        now: 10_000,
      }),
      false,
    )
  })

  it('recent inbound cancels probe need before send', () => {
    assert.equal(
      shouldRunDataConnProbe({
        connOpen: true,
        localOffersPong: true,
        remoteSupportsPong: true,
        probePending: false,
        lastSeen: 9999,
        now: 10_000,
      }),
      false,
    )
  })

  it('non-pong inbound after probeAt resolves as alive', () => {
    assert.equal(dataConnProbeSucceeded(5001, 5000), true)
  })
})

describe('probe deadline', () => {
  it('data after probeAt cancels abandonment; missing pong does not', () => {
    const probeAt = 1000
    assert.equal(dataConnProbeSucceeded(1000, probeAt), false)
    assert.equal(dataConnProbeSucceeded(1001, probeAt), true)
  })

  it('uses a 2.5s probe window', () => {
    assert.equal(DATA_CONN_PROBE_TIMEOUT_MS, 2500)
  })
})
