import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { signPhoneProof } from './proof.ts'
import { RememberHostAuth } from './hostAuth.ts'
import { shouldAcceptIncomingCall, shouldLinkSend } from './hostAuthSend.ts'
import { shouldPromoteOverConn } from './promoteGuard.ts'
import { shouldRestartListenPeer } from './allowListen.ts'
import { peerForOutboundCall } from './callPeer.ts'
import { bytesFromB64, bytesToB64, randomBytes } from './ids.ts'
import { mockConn } from './mockConn.ts'

describe('remember link auth', () => {
  it('host send() delivers nothing to an unproven remember conn', () => {
    const evil = mockConn('evil-peer')
    const host = new RememberHostAuth()
    const phones = new Map([['phone-a', { key: randomBytes(32), name: 'Phone A' }]])
    host.beginAuth(evil as never, null, {
      onPromote: () => {},
      onFail: () => {},
      onDispatch: () => {},
      onTimeout: () => {},
    })
    assert.equal(shouldLinkSend(evil, host.authPending), false)
    const inbound: unknown[] = []
    void host.handleData(evil as never, { t: 'clip:push' }, phones, null, {
      onPromote: () => {},
      onFail: () => {},
      onDispatch: (_c, m) => inbound.push(m),
      onTimeout: () => {},
    })
    assert.equal(inbound.length, 0)
    assert.equal(evil.sent.length, 0)

    const good = mockConn('good-peer')
    good.open = true
    const evil2 = mockConn('evil2-peer')
    assert.equal(host.canAcceptConnection(evil2 as never, good as never), false)
    host.beginAuth(evil2 as never, good as never, {
      onPromote: () => {},
      onFail: () => {},
      onDispatch: () => {},
      onTimeout: () => {},
    })
    assert.ok(evil2.closed)
    assert.equal(shouldLinkSend(good as never, host.authPending), true)
  })

  it('wrong proof closes the dialer and leaves the existing session intact', async () => {
    const good = mockConn('good-peer')
    const evil = mockConn('evil-peer')
    const host = new RememberHostAuth()
    const key = randomBytes(32)
    const phones = new Map([['phone-a', { key, name: 'Phone A' }]])
    const cb = {
      onPromote: () => {},
      onFail: (conn: ReturnType<typeof mockConn>) => { conn.close() },
      onDispatch: () => {},
      onTimeout: (conn: ReturnType<typeof mockConn>) => { conn.close() },
    }
    host.beginAuth(evil as never, null, cb)
    const phoneNonce = bytesToB64(randomBytes(32))
    await host.handleData(evil as never, { t: 'remember:hello', phoneId: 'phone-a', phoneNonce }, phones, good as never, cb)
    await host.handleData(
      evil as never,
      { t: 'remember:proof', proof: bytesToB64(randomBytes(32)) },
      phones,
      good as never,
      cb,
    )
    assert.ok(evil.closed)
    const denied = (evil.sent as { t?: string }[]).some((m) => m.t === 'remember:denied')
    assert.ok(denied)
    assert.equal(shouldLinkSend(good as never, host.authPending), true)
    assert.ok(shouldAcceptIncomingCall(good as never, 'good-peer'))
    assert.ok(!shouldAcceptIncomingCall(good as never, 'evil-peer'))
  })

  it('passes feature data only after a valid proof', async () => {
    const evil = mockConn('evil-peer')
    const host = new RememberHostAuth()
    const key = randomBytes(32)
    const phones = new Map([['phone-a', { key, name: 'Phone A' }]])
    const inbound: unknown[] = []
    let promoted = false
    const cb = {
      onPromote: (conn: ReturnType<typeof mockConn>) => { promoted = true },
      onFail: () => {},
      onDispatch: (_c: ReturnType<typeof mockConn>, m: unknown) => inbound.push(m),
      onTimeout: () => {},
    }
    host.beginAuth(evil as never, null, cb)
    const phoneNonceB64 = bytesToB64(randomBytes(32))
    const phoneNonce = bytesFromB64(phoneNonceB64)
    await host.handleData(evil as never, { t: 'remember:hello', phoneId: 'phone-a', phoneNonce: phoneNonceB64 }, phones, null, cb)
    const challenge = (evil.sent as { t?: string; nonce?: string }[]).find((m) => m.t === 'remember:challenge')
    assert.ok(challenge?.nonce)
    const hostNonce = bytesFromB64(challenge.nonce!)
    const proof = await signPhoneProof(key, phoneNonce, hostNonce)
    await host.handleData(evil as never, { t: 'remember:proof', proof: bytesToB64(proof) }, phones, null, cb)
    const ok = (evil.sent as { t?: string; hostProof?: string }[]).find((m) => m.t === 'remember:ok')
    assert.ok(ok?.hostProof)
    assert.ok(promoted)
    assert.equal(shouldLinkSend(evil as never, host.authPending), true)
    await host.handleData(evil as never, { t: 'file:ack', id: '1' }, phones, evil as never, cb)
    assert.ok(inbound.some((m: any) => m?.t === 'file:ack'))
  })

  it('does not promote after timeout clears auth during verify', async () => {
    const evil = mockConn('evil-peer')
    let promoted = false
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 30))
      return true
    }
    const host = new RememberHostAuth({ verifyPhoneProof: slow as never, signHostProof: async () => new Uint8Array(32) })
    const key = randomBytes(32)
    const phones = new Map([['phone-a', { key, name: 'Phone A' }]])
    const cb = {
      onPromote: () => { promoted = true },
      onFail: () => {},
      onDispatch: () => {},
      onTimeout: () => { host.clear() },
    }
    host.beginAuth(evil as never, null, cb)
    const phoneNonceB64 = bytesToB64(randomBytes(32))
    await host.handleData(evil as never, { t: 'remember:hello', phoneId: 'phone-a', phoneNonce: phoneNonceB64 }, phones, null, cb)
    const challenge = (evil.sent as { t?: string; nonce?: string }[]).find((m) => m.t === 'remember:challenge')
    const proof = bytesToB64(randomBytes(32))
    const pending = host.handleData(evil as never, { t: 'remember:proof', proof }, phones, null, cb)
    host.clear()
    await pending
    assert.equal(promoted, false)
  })

  it('does not promote over an open live conn', () => {
    const good = mockConn('good-peer')
    good.open = true
    const evil = mockConn('evil-peer')
    assert.equal(shouldPromoteOverConn(good, evil), false)
    assert.equal(shouldPromoteOverConn(null, evil), true)
  })

  it('screen calls use the peer that owns the data conn', () => {
    const listen = { id: 'listen' } as never
    const main = { id: 'main' } as never
    assert.equal(peerForOutboundCall(listen, main), listen)
    assert.equal(peerForOutboundCall(null, main), main)
  })

  it('skips listen peer restart when the session rides it', () => {
    assert.equal(shouldRestartListenPeer(true), false)
    assert.equal(shouldRestartListenPeer(false), true)
  })

  it('sends remember:denied for unknown phoneId before close', async () => {
    const evil = mockConn('evil-peer')
    const host = new RememberHostAuth()
    const key = randomBytes(32)
    const phones = new Map([['phone-a', { key, name: 'Phone A' }]])
    const cb = {
      onPromote: () => {},
      onFail: (_c: ReturnType<typeof mockConn>, reason: string) => assert.equal(reason, 'denied'),
      onDispatch: () => {},
      onTimeout: () => {},
    }
    host.beginAuth(evil as never, null, cb)
    await host.handleData(
      evil as never,
      { t: 'remember:hello', phoneId: 'unknown', phoneNonce: bytesToB64(randomBytes(32)) },
      phones,
      null,
      cb,
    )
    assert.ok((evil.sent as { t?: string }[]).some((m) => m.t === 'remember:denied'))
  })

  it('backs off new remember dials for 1s after auth failure', () => {
    const host = new RememberHostAuth()
    const c = mockConn('x')
    host.beginAuth(c as never, null, {
      onPromote: () => {},
      onFail: () => {},
      onDispatch: () => {},
      onTimeout: () => {},
    })
    host.listenAuthBackoffUntil = Date.now() + 1000
    const c2 = mockConn('y')
    assert.equal(host.canAcceptConnection(c2 as never, null), false)
  })
})
