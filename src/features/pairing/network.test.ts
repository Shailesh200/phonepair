import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORCED_HOST_SIGNAL_RECONNECT_MIN_MS,
  HOST_HIDDEN_RECONNECT_MS,
  isHalfOpenSignalConn,
  planHostSignalReconnect,
  shouldHostReconnectAfterVisibility,
  shouldHostReconnectHalfOpen,
  shouldHostReconnectOnOnline,
  shouldSkipHostDisconnectedHandler,
} from './hostSignalReconnect.ts'
import {
  canAttemptIceRestart,
  canGuestIceRedial,
  iceTransportRecovered,
  ICE_DISCONNECTED_RESTART_MS,
  ICE_RESTART_RECOVERY_MS,
  isDataConnIceOfferer,
  shouldActOnIceNetworkChange,
  shouldRedialAfterIceRestart,
  shouldRedialImmediatelyOnIceFailed,
  shouldRestartIce,
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
    assert.equal(shouldHostReconnectOnOnline('guest', false), false)
    assert.equal(shouldHostReconnectAfterVisibility(HOST_HIDDEN_RECONNECT_MS + 1), true)
    assert.equal(shouldHostReconnectAfterVisibility(HOST_HIDDEN_RECONNECT_MS), false)
    assert.equal(isHalfOpenSignalConn(true, false), true)
    assert.equal(shouldHostReconnectHalfOpen('host', false, true, false), true)
    assert.equal(shouldHostReconnectHalfOpen('guest', false, true, false), false)
  })

  it('plans forced signalling reconnect with throttle and PeerJS paths', () => {
    assert.equal(
      planHostSignalReconnect({ ...base, peerDisconnected: true }),
      'reconnect',
    )
    assert.equal(
      planHostSignalReconnect({ ...base, peerDisconnected: false }),
      'disconnect-then-reconnect',
    )
    assert.equal(
      planHostSignalReconnect({
        ...base,
        peerDisconnected: false,
        lastForcedAt: base.now - FORCED_HOST_SIGNAL_RECONNECT_MIN_MS + 1,
      }),
      'skip',
    )
    assert.equal(
      planHostSignalReconnect({ ...base, peerDisconnected: true, forceInFlight: true }),
      'skip',
    )
    assert.equal(
      planHostSignalReconnect({ ...base, peerDestroyed: true, peerDisconnected: true }),
      'skip',
    )
    assert.equal(shouldSkipHostDisconnectedHandler(true), true)
    assert.equal(shouldSkipHostDisconnectedHandler(false), false)
  })
})

describe('ice recovery', () => {
  const t0 = 10_000
  it('redials on failed ice; restartIce path only for long disconnect', () => {
    assert.equal(isDataConnIceOfferer('guest'), true)
    assert.equal(shouldRedialImmediatelyOnIceFailed('failed'), true)
    assert.equal(shouldRedialImmediatelyOnIceFailed('disconnected'), false)
    assert.equal(shouldRestartIce('failed', null, t0), false)
    assert.equal(
      shouldRestartIce('disconnected', t0 - ICE_DISCONNECTED_RESTART_MS, t0 + 1),
      true,
    )
    assert.equal(shouldActOnIceNetworkChange('connected'), false)
    assert.equal(shouldActOnIceNetworkChange('disconnected'), true)
    assert.equal(iceTransportRecovered('connected'), true)
    assert.equal(canAttemptIceRestart(true, 0, t0), false)
    assert.equal(canGuestIceRedial(true, false, false), false)
    assert.equal(canGuestIceRedial(false, false, false), true)
    const restartAt = t0
    assert.equal(
      shouldRedialAfterIceRestart(restartAt, 'disconnected', restartAt + ICE_RESTART_RECOVERY_MS),
      true,
    )
    assert.equal(
      shouldRedialAfterIceRestart(restartAt, 'connected', restartAt + ICE_RESTART_RECOVERY_MS),
      false,
    )
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
    const urls = allIceUrls(api)
    assert.equal(urls.length, 3)
    assert.ok(urls.some((u) => u.includes('transport=tcp')))
    assert.ok(urls.some((u) => u.startsWith('turns:')))
  })
})
