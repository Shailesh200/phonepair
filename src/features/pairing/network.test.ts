import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_HIDDEN_RECONNECT_MS,
  isHalfOpenSignalConn,
  shouldHostReconnectAfterVisibility,
  shouldHostReconnectHalfOpen,
  shouldHostReconnectOnOnline,
} from './hostSignalReconnect.ts'
import {
  canAttemptIceRestart,
  iceTransportRecovered,
  ICE_DISCONNECTED_RESTART_MS,
  ICE_RESTART_RECOVERY_MS,
  isDataConnIceOfferer,
  shouldRedialAfterIceRestart,
  shouldRestartIce,
} from './iceRecovery.ts'
import { candidatePairUsesRelay } from './relayStats.ts'
import { allIceUrls, iceServersFromTurnApi } from './iceServerMap.ts'

describe('host signal reconnect', () => {
  it('reconnects host on online and after long hide', () => {
    assert.equal(shouldHostReconnectOnOnline('host', false), true)
    assert.equal(shouldHostReconnectOnOnline('guest', false), false)
    assert.equal(shouldHostReconnectAfterVisibility(HOST_HIDDEN_RECONNECT_MS + 1), true)
    assert.equal(shouldHostReconnectAfterVisibility(HOST_HIDDEN_RECONNECT_MS), false)
    assert.equal(isHalfOpenSignalConn(true, false), true)
    assert.equal(shouldHostReconnectHalfOpen('host', false, true, false), true)
    assert.equal(shouldHostReconnectHalfOpen('guest', false, true, false), false)
  })
})

describe('ice recovery', () => {
  const t0 = 10_000
  it('restarts ice for guest offerer when disconnected long enough or failed', () => {
    assert.equal(isDataConnIceOfferer('guest'), true)
    assert.equal(isDataConnIceOfferer('host'), false)
    assert.equal(shouldRestartIce('failed', null, t0), true)
    assert.equal(
      shouldRestartIce('disconnected', t0 - ICE_DISCONNECTED_RESTART_MS, t0 + 1),
      true,
    )
    assert.equal(shouldRestartIce('disconnected', t0, t0 + 100), false)
    assert.equal(iceTransportRecovered('connected'), true)
    assert.equal(canAttemptIceRestart(true, 0, t0), false)
    assert.equal(canAttemptIceRestart(false, t0, t0 + 2500), true)
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
