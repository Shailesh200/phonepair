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
import { forgetHostPhoneRecord, type HostStore } from './records.ts'

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

describe('remember forget', () => {
  it('removes a phone key and clears listen when the last phone is forgotten', () => {
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
