import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  DATA_CONN_PROBE_POST_RESTORE_MS,
  DATA_CONN_PROBE_SKIP_RECENT_MS,
  DATA_CONN_PROBE_TIMEOUT_MS,
  buildLinkHelloMessage,
  connProbeMayAbandonAfterFail,
  connProbeRetryDelayMs,
  connProbeSentOnTick,
  dataConnProbeSucceeded,
  planTickOpenConnTraffic,
  shouldSendTickConnKeepalivePing,
  freshRemotePongCap,
  helloCapsIncludePong,
  recordRemoteHelloPongCap,
  remotePongCapSeenForPeer,
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

describe('remote pong cap ledger', () => {
  const freshPair = {
    everConnected: true,
    sessionPaired: true,
    rememberGuestAuth: false,
  }
  const probeBase = {
    connOpen: true,
    localOffersPong: true,
    probePending: false,
    lastSeen: 0,
    now: 10_000,
  }

  it('new phone and laptop: cut restore before new hello probes when cap was recorded', () => {
    const hostLedger = new Map<string, boolean>()
    const phoneLedger = new Map<string, boolean>()
    const phonePeer = 'guest-new-1'
    const hostPeer = 'phonepair-ab12cd'
    recordRemoteHelloPongCap(hostLedger, phonePeer, ['pong'])
    recordRemoteHelloPongCap(phoneLedger, hostPeer, ['pong'])
    freshRemotePongCap()
    freshRemotePongCap()
    assert.equal(
      shouldMarkConnProbeEligible({ connOpen: true, connProbeEligible: false, ...freshPair }),
      true,
    )
    assert.equal(
      shouldRunDataConnProbe({
        ...probeBase,
        remoteSupportsPong: remotePongCapSeenForPeer(hostLedger, phonePeer),
      }),
      true,
    )
    assert.equal(
      shouldRunDataConnProbe({
        ...probeBase,
        remoteSupportsPong: remotePongCapSeenForPeer(phoneLedger, hostPeer),
      }),
      true,
    )
  })

  it('old peer without pong cap in hello is never probed, even after cut on a fresh pair', () => {
    const ledger = new Map<string, boolean>()
    const oldPeer = 'legacy-guest'
    recordRemoteHelloPongCap(ledger, oldPeer, undefined)
    assert.equal(remotePongCapSeenForPeer(ledger, oldPeer), false)
    assert.equal(
      shouldMarkConnProbeEligible({ connOpen: true, connProbeEligible: true, ...freshPair }),
      true,
    )
    assert.equal(
      shouldRunDataConnProbe({
        ...probeBase,
        remoteSupportsPong: remotePongCapSeenForPeer(ledger, oldPeer),
      }),
      false,
    )
  })

  it('cap phone then different old phone: ledger does not cross peers', () => {
    const ledger = new Map<string, boolean>()
    const capPhone = 'guest-cap'
    const oldPhone = 'guest-old'
    recordRemoteHelloPongCap(ledger, capPhone, ['pong'])
    freshRemotePongCap()
    assert.equal(remotePongCapSeenForPeer(ledger, capPhone), true)
    recordRemoteHelloPongCap(ledger, oldPhone, [])
    assert.equal(remotePongCapSeenForPeer(ledger, oldPhone), false)
    assert.equal(
      shouldRunDataConnProbe({
        ...probeBase,
        remoteSupportsPong: remotePongCapSeenForPeer(ledger, oldPhone),
      }),
      false,
    )
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

  it('runs after signal restore even when lastSeen was bumped within 2s', () => {
    const restoreAt = 10_000
    const now = restoreAt + 500
    assert.equal(
      shouldRunDataConnProbe({
        ...base,
        lastSeen: now - 1,
        now,
        restoreSignalAt: restoreAt,
      }),
      true,
    )
    const afterWindow = restoreAt + DATA_CONN_PROBE_POST_RESTORE_MS + 1
    assert.equal(
      shouldRunDataConnProbe({
        ...base,
        lastSeen: afterWindow - 1,
        now: afterWindow,
        restoreSignalAt: restoreAt,
      }),
      false,
    )
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

describe('connProbeRetryDelayMs', () => {
  it('waits until the recent-traffic window passes', () => {
    const now = 10_000
    assert.equal(connProbeRetryDelayMs(now - 500, now), 1500)
    assert.equal(connProbeRetryDelayMs(now - 3000, now), 0)
  })
})

describe('shouldMarkConnProbeEligible remember sessions', () => {
  it('marks remember-guest sessions eligible after pairing', () => {
    assert.equal(
      shouldMarkConnProbeEligible({
        connOpen: true,
        connProbeEligible: false,
        everConnected: true,
        sessionPaired: true,
        rememberGuestAuth: true,
      }),
      true,
    )
  })
})

describe('tick keepalive vs probe', () => {
  it('old peer without pong cap gets keepalive ping every tick, never a probe', () => {
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
    assert.equal(
      planTickOpenConnTraffic({ connOpen: true, probeWouldRun: false }),
      'keepalive-ping',
    )
    assert.equal(shouldSendTickConnKeepalivePing({ connOpen: true, probeSentThisTick: false }), true)
  })

  it('probe-eligible session sends a probe or keepalive, never neither', () => {
    assert.equal(planTickOpenConnTraffic({ connOpen: true, probeWouldRun: true }), 'probe')
    assert.equal(planTickOpenConnTraffic({ connOpen: true, probeWouldRun: false }), 'keepalive-ping')
    assert.equal(shouldSendTickConnKeepalivePing({ connOpen: true, probeSentThisTick: true }), false)
    assert.equal(connProbeSentOnTick(5000, 5000), true)
    assert.equal(connProbeSentOnTick(4999, 5000), false)
  })
})

describe('connProbeMayAbandonAfterFail', () => {
  it('with fake clock, slow post-restore link abandons at most once per restore window', () => {
    mock.timers.enable({ apis: ['Date'] })
    const restoreAt = 0
    let lastAbandonRestoreAt: number | null = null
    let lastAbandonConnGen: number | null = null
    let connGen = 1
    let abandonCount = 0
    const tickMs = [0, 2500, 4000, 8000, 12_000, 20_000, 25_500]
    for (const now of tickMs) {
      mock.timers.setTime(now)
      if (now === 8000) connGen = 2
      if (
        connProbeMayAbandonAfterFail({
          restoreSignalAt: restoreAt,
          connGen,
          lastAbandonRestoreAt,
          lastAbandonConnGen,
          now,
        })
      ) {
        abandonCount += 1
        lastAbandonRestoreAt = restoreAt
        lastAbandonConnGen = connGen
      }
    }
    assert.equal(abandonCount, 1)
    mock.timers.reset()
  })

  it('post-restore window: one abandon total; outside window: one per connGen', () => {
    const restore = 1_000
    const inside = restore + 5_000
    const outside = restore + DATA_CONN_PROBE_POST_RESTORE_MS + 1
    assert.equal(
      connProbeMayAbandonAfterFail({
        restoreSignalAt: restore,
        connGen: 1,
        lastAbandonRestoreAt: null,
        lastAbandonConnGen: null,
        now: inside,
      }),
      true,
    )
    assert.equal(
      connProbeMayAbandonAfterFail({
        restoreSignalAt: restore,
        connGen: 1,
        lastAbandonRestoreAt: restore,
        lastAbandonConnGen: 1,
        now: inside,
      }),
      false,
    )
    assert.equal(
      connProbeMayAbandonAfterFail({
        restoreSignalAt: restore,
        connGen: 2,
        lastAbandonRestoreAt: restore,
        lastAbandonConnGen: 1,
        now: inside,
      }),
      false,
    )
    assert.equal(
      connProbeMayAbandonAfterFail({
        restoreSignalAt: restore + 1,
        connGen: 1,
        lastAbandonRestoreAt: restore,
        lastAbandonConnGen: 1,
        now: restore + 1 + 1_000,
      }),
      true,
    )
    assert.equal(
      connProbeMayAbandonAfterFail({
        restoreSignalAt: null,
        connGen: 1,
        lastAbandonRestoreAt: restore,
        lastAbandonConnGen: 1,
        now: outside,
      }),
      false,
    )
    assert.equal(
      connProbeMayAbandonAfterFail({
        restoreSignalAt: null,
        connGen: 2,
        lastAbandonRestoreAt: restore,
        lastAbandonConnGen: 1,
        now: outside,
      }),
      true,
    )
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
