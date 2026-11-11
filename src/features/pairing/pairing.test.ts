import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CODE_ALPHABET, isValidPairCode, normalizePairCode } from './code.ts'
import { buildRtcConfiguration, mergeIceServers } from './peerConfig.ts'

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

describe('peer rtc config', () => {
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
})
