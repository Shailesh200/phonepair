import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HOST_UNAVAILABLE_ID_MAX_TRIES, hostUnavailableIdBackoffMs, hostUnavailableIdGiveUp } from './hostClaim.ts'
import {
  ensureHostReclaimStarted,
  HOST_ID_RECLAIM_MIN_MS,
  hostReclaimDelayBeforeAttempt,
  hostReclaimIdBackoffMs,
  hostReclaimIdGiveUp,
  hostUnavailableIdBackoffForClaim,
  hostUnavailableIdShouldGiveUp,
  shouldUseHostIdReclaimWindow,
} from './hostIdReclaim.ts'
import {
  FORCED_HOST_SIGNAL_RECONNECT_MIN_MS,
  HOST_FORCE_SIGNAL_TIMEOUT_MS,
  HOST_HIDDEN_RECONNECT_MS,
  isHalfOpenSignalConn,
  planHostSignalReconnect,
  shouldClearHostForceSignalOnPeerError,
  shouldExpireHostForceSignalInFlight,
  shouldHostReconnectAfterVisibility,
  shouldHostReconnectHalfOpen,
  shouldHostReconnectOnOnline,
  shouldSkipHostDisconnectedHandler,
} from './hostSignalReconnect.ts'
import {
  canGuestIceRedial,
  ICE_DISCONNECTED_GRACE_MS,
  iceDisconnectedRedialDelayMs,
  iceTransportRecovered,
  isDataConnIceOfferer,
  shouldActOnIceNetworkChange,
  shouldArmIceGraceTimer,
  shouldRedialAfterDisconnectedGrace,
  shouldRedialImmediatelyOnIceFailed,
} from './iceRecovery.ts'
import { candidatePairUsesRelay } from './relayStats.ts'
import { allIceUrls, iceServersFromTurnApi } from './iceServerMap.ts'

describe('host signal reconnect', () => {
  const base = {
    role: 'host' as const,
    linkDestroyed: false,
    peerDestroyed: false,
    forceInFlight: false,
    lastForcedAt: 0,
    now: 20_000,
  }

  it('reconnects host on online and after long hide', () => {
    assert.equal(shouldHostReconnectOnOnline('host', false), true)
    assert.equal(shouldHostReconnectAfterVisibility(HOST_HIDDEN_RECONNECT_MS + 1), true)
    assert.equal(isHalfOpenSignalConn(true, false), true)
    assert.equal(shouldHostReconnectHalfOpen('host', false, true, false), true)
  })

  it('plans forced signalling reconnect with throttle and PeerJS paths', () => {
    assert.equal(planHostSignalReconnect({ ...base, peerDisconnected: true }), 'reconnect')
    assert.equal(planHostSignalReconnect({ ...base, peerDisconnected: false }), 'disconnect-then-reconnect')
    assert.equal(
      planHostSignalReconnect({
        ...base,
        peerDisconnected: false,
        lastForcedAt: base.now - FORCED_HOST_SIGNAL_RECONNECT_MIN_MS + 1,
      }),
      'skip',
    )
    assert.equal(shouldSkipHostDisconnectedHandler(true), true)
  })

  it('expires stuck host force flag after safety timeout', () => {
    const t0 = 50_000
    assert.equal(shouldExpireHostForceSignalInFlight(true, t0, t0 + HOST_FORCE_SIGNAL_TIMEOUT_MS), true)
    assert.equal(shouldClearHostForceSignalOnPeerError(true, true, 'network', false), true)
    assert.equal(shouldClearHostForceSignalOnPeerError(true, true, 'unavailable-id', true), false)
  })
})

describe('host id reclaim window', () => {
  const t0 = 0
  it('uses reclaim backoff 1,2,4,8 then 10s and gives up only after 75s', () => {
    assert.equal(hostReclaimIdBackoffMs(1), 1000)
    assert.equal(hostReclaimDelayBeforeAttempt(5), 15_000)
    assert.equal(hostUnavailableIdShouldGiveUp(8, t0, 15_000, true), false)
    assert.equal(hostUnavailableIdShouldGiveUp(8, t0, 75_000, true), true)
    assert.equal(hostReclaimIdGiveUp(t0, 75_000), true)
  })

  it('opens reclaim after everConnected, including silent signalling drops', () => {
    assert.equal(shouldUseHostIdReclaimWindow(true, t0), true)
    assert.equal(shouldUseHostIdReclaimWindow(false, t0), false)
    assert.equal(shouldUseHostIdReclaimWindow(true, null), false)
    assert.equal(ensureHostReclaimStarted(true, null, 100), 100)
    assert.equal(ensureHostReclaimStarted(false, null, 100), null)
    assert.equal(ensureHostReclaimStarted(true, 50, 100), 50)
  })

  it('keeps normal first claim give-up at 8 tries', () => {
    assert.equal(hostUnavailableIdShouldGiveUp(1, null, 0, false), false)
    assert.equal(hostUnavailableIdShouldGiveUp(HOST_UNAVAILABLE_ID_MAX_TRIES + 1, null, 0, false), true)
    assert.equal(hostUnavailableIdBackoffForClaim(1, null, false), hostUnavailableIdBackoffMs(1))
    assert.equal(hostUnavailableIdShouldGiveUp(8, null, 15_000, false), false)
    assert.equal(hostUnavailableIdShouldGiveUp(8, null, 15_000, true), false)
  })
})

describe('ice recovery', () => {
  const t0 = 10_000
  it('redials immediately on failed; disconnected uses a single 13s grace timer', () => {
    assert.equal(isDataConnIceOfferer('guest'), true)
    assert.equal(shouldRedialImmediatelyOnIceFailed('failed'), true)
    assert.equal(shouldActOnIceNetworkChange('connected'), false)
    assert.equal(iceTransportRecovered('connected'), true)
    assert.equal(iceDisconnectedRedialDelayMs(t0, t0 + 5000), ICE_DISCONNECTED_GRACE_MS - 5000)
    assert.equal(iceDisconnectedRedialDelayMs(t0, t0), ICE_DISCONNECTED_GRACE_MS)
    assert.equal(
      shouldRedialAfterDisconnectedGrace(t0, 'disconnected', t0 + ICE_DISCONNECTED_GRACE_MS),
      true,
    )
    assert.equal(shouldArmIceGraceTimer(true, t0), false)
    assert.equal(shouldArmIceGraceTimer(false, t0), true)
    assert.equal(canGuestIceRedial(false, false, false), true)
  })
})

describe('relay stats', () => {
  it('detects relay on local or remote selected candidate', () => {
    const stats = new Map<string, RTCStats>([
      ['t', { id: 't', timestamp: 1, type: 'transport', selectedCandidatePairId: 'p' } as RTCTransportStats],
      ['p', {
        id: 'p',
        timestamp: 1,
        type: 'candidate-pair',
        nominated: true,
        state: 'succeeded',
        localCandidateId: 'loc',
        remoteCandidateId: 'rem',
      } as RTCIceCandidatePairStats],
      ['loc', { id: 'loc', timestamp: 1, type: 'local-candidate', candidateType: 'host' } as RTCStats],
      ['rem', { id: 'rem', timestamp: 1, type: 'remote-candidate', candidateType: 'relay' } as RTCStats],
    ]) as RTCStatsReport
    assert.equal(candidatePairUsesRelay(stats), true)
  })
})

describe('ice server map', () => {
  const TRAEFIK_TURNS_URL = 'turns:turn.167.233.223.123.sslip.io:443?transport=tcp'

  it('keeps every url from the turn api including tcp and turns', () => {
    const api = iceServersFromTurnApi([
      {
        urls: [
          'turn:relay:3478?transport=udp',
          'turn:relay:3478?transport=tcp',
          'turns:relay:5349?transport=tcp',
        ],
        username: 'u',
        credential: 'c',
      },
    ])
    assert.equal(allIceUrls(api).length, 3)
  })

  it('preserves the Traefik TLS turns url from /api/turn', () => {
    const api = iceServersFromTurnApi([
      {
        urls: [
          'turn:167.233.223.123:3478?transport=udp',
          'turn:167.233.223.123:3478?transport=tcp',
          TRAEFIK_TURNS_URL,
        ],
        username: 'u',
        credential: 'c',
      },
    ])
    assert.ok(allIceUrls(api).includes(TRAEFIK_TURNS_URL))
  })
})
