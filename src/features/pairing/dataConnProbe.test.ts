import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DATA_CONN_PROBE_SKIP_RECENT_MS,
  DATA_CONN_PROBE_TIMEOUT_MS,
  dataConnProbeSucceeded,
  helloCapsIncludePong,
  shouldRunDataConnProbe,
} from './dataConnProbe.ts'

describe('hello pong capability', () => {
  it('old hello without caps is not probed', () => {
    assert.equal(helloCapsIncludePong(undefined), false)
    assert.equal(helloCapsIncludePong([]), false)
    assert.equal(helloCapsIncludePong(['clip']), false)
    assert.equal(helloCapsIncludePong(['pong']), true)
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
