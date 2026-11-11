import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { guestAcceptsRememberOk } from './guestAuth.ts'
import { verifyPhoneProof, signHostProof, signPhoneProof } from './proof.ts'
import { bytesToB64, randomBytes } from './ids.ts'

describe('remember mutual auth', () => {
  it('rejects a forged ok with bad or missing hostProof', async () => {
    const key = randomBytes(32)
    const phoneNonce = randomBytes(32)
    assert.equal(await guestAcceptsRememberOk({ t: 'remember:ok' }, key, phoneNonce), false)
    assert.equal(await guestAcceptsRememberOk({ t: 'remember:ok', hostProof: bytesToB64(randomBytes(32)) }, key, phoneNonce), false)
  })

  it('rejects reflected proofs (wrong domain)', async () => {
    const key = randomBytes(32)
    const phoneNonce = randomBytes(32)
    const hostNonce = randomBytes(32)
    const phoneProof = await signPhoneProof(key, hostNonce)
    assert.equal(await guestAcceptsRememberOk({ t: 'remember:ok', hostProof: bytesToB64(phoneProof) }, key, phoneNonce), false)
    const hostProof = await signHostProof(key, phoneNonce)
    assert.equal(await verifyPhoneProof(key, hostNonce, hostProof), false)
  })

  it('accepts a valid ok and opens verify path', async () => {
    const key = randomBytes(32)
    const phoneNonce = randomBytes(32)
    const hostProof = await signHostProof(key, phoneNonce)
    assert.equal(await guestAcceptsRememberOk({ t: 'remember:ok', hostProof: bytesToB64(hostProof) }, key, phoneNonce), true)
  })
})
