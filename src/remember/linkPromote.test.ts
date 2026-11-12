import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canPromoteDataConn } from './promoteEligibility.ts'
import { RememberHostAuth } from './hostAuth.ts'
import { signPhoneProof } from './proof.ts'
import { bytesFromB64, bytesToB64, randomBytes } from './ids.ts'
import { mockConn } from './mockConn.ts'

describe('remember host promotion', () => {
  it('allows promote when conn only came from the listen peer', () => {
    const c = { id: 'remember-conn' }
    assert.equal(
      canPromoteDataConn({
        fromGuestAuthPending: false,
        fromRememberListen: true,
        conn: c,
        inFlightDial: null,
        pending: null,
        liveConn: null,
      }),
      true,
    )
    assert.equal(
      canPromoteDataConn({
        fromGuestAuthPending: false,
        fromRememberListen: false,
        conn: c,
        inFlightDial: null,
        pending: null,
        liveConn: null,
      }),
      false,
    )
  })

  it('after a valid proof the host is connected and feature data flows both ways', async () => {
    const phoneConn = mockConn('phone-peer')
    const hostAuth = new RememberHostAuth()
    const key = randomBytes(32)
    const phones = new Map([['phone-a', { key, name: 'Pixel' }]])
    let status = 'waiting'
    let liveConn: typeof phoneConn | null = null
    const inbound: unknown[] = []
    const cb = {
      onPromote: (conn: typeof phoneConn) => {
        if (!canPromoteDataConn({
          fromGuestAuthPending: false,
          fromRememberListen: true,
          conn,
          inFlightDial: null,
          pending: null,
          liveConn: null,
        })) return
        liveConn = conn
        status = 'connected'
      },
      onFail: () => {},
      onDispatch: (_c: typeof phoneConn, m: unknown) => inbound.push(m),
      onTimeout: () => {},
    }
    hostAuth.beginAuth(phoneConn as never, null, cb)
    const phoneNonceB64 = bytesToB64(randomBytes(32))
    await hostAuth.handleData(
      phoneConn as never,
      { t: 'remember:hello', phoneId: 'phone-a', phoneNonce: phoneNonceB64 },
      phones,
      null,
      cb,
    )
    const challenge = (phoneConn.sent as { t?: string; nonce?: string }[]).find((m) => m.t === 'remember:challenge')
    const hostNonce = bytesFromB64(challenge!.nonce!)
    const proof = await signPhoneProof(key, bytesFromB64(phoneNonceB64), hostNonce)
    await hostAuth.handleData(
      phoneConn as never,
      { t: 'remember:proof', proof: bytesToB64(proof) },
      phones,
      null,
      cb,
    )
    assert.equal(status, 'connected')
    assert.equal(liveConn, phoneConn)
    const ok = (phoneConn.sent as { t?: string }[]).some((m) => m.t === 'remember:ok')
    assert.ok(ok)
    await hostAuth.handleData(phoneConn as never, { t: 'clip:push', text: 'hi' }, phones, phoneConn as never, cb)
    assert.ok(inbound.some((m: any) => m?.t === 'clip:push'))
    try { liveConn!.send({ t: 'clip:reply', ok: true }) } catch {}
    assert.ok(phoneConn.sent.some((m: any) => m?.t === 'clip:reply'))
  })

  it('clears auth pending on early return when phoneId is missing after proof', async () => {
    const phoneConn = mockConn('phone-peer')
    const hostAuth = new RememberHostAuth()
    const key = randomBytes(32)
    const phones = new Map([['phone-a', { key, name: 'Pixel' }]])
    const cb = {
      onPromote: () => {},
      onFail: () => {},
      onDispatch: () => {},
      onTimeout: () => {},
    }
    hostAuth.beginAuth(phoneConn as never, null, cb)
    const phoneNonceB64 = bytesToB64(randomBytes(32))
    await hostAuth.handleData(
      phoneConn as never,
      { t: 'remember:hello', phoneId: 'phone-a', phoneNonce: phoneNonceB64 },
      phones,
      null,
      cb,
    )
    assert.ok(hostAuth.authPending)
    hostAuth.authPending!.phoneId = null
    const challenge = (phoneConn.sent as { t?: string; nonce?: string }[]).find((m) => m.t === 'remember:challenge')
    const hostNonce = bytesFromB64(challenge!.nonce!)
    const proof = await signPhoneProof(key, bytesFromB64(phoneNonceB64), hostNonce)
    await hostAuth.handleData(
      phoneConn as never,
      { t: 'remember:proof', proof: bytesToB64(proof) },
      phones,
      null,
      cb,
    )
    assert.equal(hostAuth.authPending, null)
  })

  it('clears auth pending when onPromote throws', async () => {
    const phoneConn = mockConn('phone-peer')
    const hostAuth = new RememberHostAuth()
    const key = randomBytes(32)
    const phones = new Map([['phone-a', { key, name: 'Pixel' }]])
    const cb = {
      onPromote: () => { throw new Error('promote failed') },
      onFail: () => {},
      onDispatch: () => {},
      onTimeout: () => {},
    }
    hostAuth.beginAuth(phoneConn as never, null, cb)
    const phoneNonceB64 = bytesToB64(randomBytes(32))
    await hostAuth.handleData(
      phoneConn as never,
      { t: 'remember:hello', phoneId: 'phone-a', phoneNonce: phoneNonceB64 },
      phones,
      null,
      cb,
    )
    const challenge = (phoneConn.sent as { t?: string; nonce?: string }[]).find((m) => m.t === 'remember:challenge')
    const hostNonce = bytesFromB64(challenge!.nonce!)
    const proof = await signPhoneProof(key, bytesFromB64(phoneNonceB64), hostNonce)
    await assert.rejects(async () => hostAuth.handleData(
      phoneConn as never,
      { t: 'remember:proof', proof: bytesToB64(proof) },
      phones,
      null,
      cb,
    ))
    assert.equal(hostAuth.authPending, null)
  })

})
