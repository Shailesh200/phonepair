import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hmacSha256 } from './crypto.ts'
import { RememberHostAuth } from './hostAuth.ts'
import { shouldAcceptIncomingCall, shouldLinkSend } from './hostAuthSend.ts'
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
      onFail: (conn: ReturnType<typeof mockConn>) => { host.clear(); conn.close() },
      onDispatch: () => {},
      onTimeout: (conn: ReturnType<typeof mockConn>) => { host.clear(); conn.close() },
    }
    host.beginAuth(evil as never, good as never, cb)
    await host.handleData(evil as never, { t: 'remember:hello', phoneId: 'phone-a' }, phones, good as never, cb)
    await host.handleData(
      evil as never,
      { t: 'remember:proof', proof: bytesToB64(randomBytes(32)) },
      phones,
      good as never,
      cb,
    )
    assert.ok(evil.closed)
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
      onPromote: (conn: ReturnType<typeof mockConn>) => { promoted = true; host.clear() },
      onFail: () => {},
      onDispatch: (_c: ReturnType<typeof mockConn>, m: unknown) => inbound.push(m),
      onTimeout: () => {},
    }
    host.beginAuth(evil as never, null, cb)
    await host.handleData(evil as never, { t: 'remember:hello', phoneId: 'phone-a' }, phones, null, cb)
    const challenge = (evil.sent as { t?: string; nonce?: string }[]).find((m) => m.t === 'remember:challenge')
    assert.ok(challenge?.nonce)
    const proof = await hmacSha256(key, bytesFromB64(challenge.nonce!))
    await host.handleData(evil as never, { t: 'remember:proof', proof: bytesToB64(proof) }, phones, null, cb)
    assert.ok(promoted)
    assert.equal(shouldLinkSend(evil as never, host.authPending), true)
    await host.handleData(evil as never, { t: 'file:ack', id: '1' }, phones, evil as never, cb)
    assert.ok(inbound.some((m: any) => m?.t === 'file:ack'))
  })
})
