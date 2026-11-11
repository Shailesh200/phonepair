import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import WebSocket from 'ws'
import { LOOPBACK, startHelper } from '../dist/server.js'

const ORIGIN = 'https://phonepair.vercel.app'

function injector() {
  const calls = []
  return {
    calls,
    async move(dx, dy) { calls.push(['move', dx, dy]) },
    async click(btn) { calls.push(['click', btn]) },
    async scroll(dx, dy) { calls.push(['scroll', dx, dy]) },
    async key(key, mods) { calls.push(['key', key, mods]) },
    async type(text) { calls.push(['type', text]) },
  }
}

async function boot(t, opts = {}) {
  const inject = injector()
  const logs = []
  const helper = await startHelper({
    code: opts.code ?? '042817',
    inject,
    ports: opts.ports ?? [0],
    log: (line) => logs.push(line),
    now: opts.now ?? (() => opts.clock ?? 5_000_000),
    authTimeoutMs: opts.authTimeoutMs ?? 400,
  })
  t.after(() => helper.close())
  assert.equal(helper.host, LOOPBACK)
  return { helper, inject, logs }
}

function connect(port, origin = ORIGIN) {
  return new WebSocket(`ws://${LOOPBACK}:${port}`, { origin })
}

function onceMessage(ws) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 1000)
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(String(data)))
    })
  })
}

function openSession(port, origin = ORIGIN) {
  const ws = connect(port, origin)
  return { ws, incoming: onceMessage(ws) }
}

function opened(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) resolve()
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
}

async function waitFor(fn, ms = 800) {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (fn()) return
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
  throw new Error('timed out')
}

test('preflight allows private network access only for known origins', async (t) => {
  const { helper } = await boot(t)
  const ok = await fetch(`http://${LOOPBACK}:${helper.port}`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Private-Network': 'true',
    },
  })
  assert.equal(ok.status, 204)
  assert.equal(ok.headers.get('access-control-allow-private-network'), 'true')
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN)
  const local = await fetch(`http://${LOOPBACK}:${helper.port}`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
  })
  assert.equal(local.headers.get('access-control-allow-private-network'), 'true')
  const bad = await fetch(`http://${LOOPBACK}:${helper.port}`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.test', 'Access-Control-Request-Private-Network': 'true' },
  })
  assert.equal(bad.status, 403)
  assert.equal(bad.headers.get('access-control-allow-private-network'), null)
})

test('a bad origin never opens a socket', async (t) => {
  const { helper, inject } = await boot(t)
  const ws = connect(helper.port, 'https://evil.test')
  const result = await new Promise((resolve) => {
    ws.once('open', () => resolve('open'))
    ws.once('error', () => resolve('error'))
    ws.once('unexpected-response', () => resolve('unexpected'))
  })
  assert.notEqual(result, 'open')
  assert.equal(inject.calls.length, 0)
})

test('the first message must carry the pairing code, then input is forwarded', async (t) => {
  const { helper, inject, logs } = await boot(t)
  const ws = connect(helper.port)
  await opened(ws)
  ws.send(JSON.stringify({ t: 'move', dx: 4, dy: 4 }))
  const rejected = await onceMessage(ws)
  assert.equal(rejected.t, 'rejected')
  assert.equal(inject.calls.length, 0)

  const good = connect(helper.port)
  await opened(good)
  good.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await onceMessage(good), { t: 'paired' })
  assert.deepEqual(logs, ['CONTROL ON (paired)'])
  good.send(JSON.stringify({ t: 'move', dx: 99999, dy: -4 }))
  good.send(JSON.stringify({ t: 'click', btn: 'right' }))
  good.send(JSON.stringify({ t: 'key', key: 'ArrowUp', mods: ['shift'] }))
  good.send(JSON.stringify({ t: 'type', text: 'Hi' }))
  good.send(JSON.stringify({ t: 'exec', cmd: 'id' }))
  good.send(JSON.stringify({ t: 'key', key: 'rm -rf' }))
  await waitFor(() => inject.calls.length >= 4)
  assert.deepEqual(inject.calls, [
    ['move', 2000, -4],
    ['click', 'right'],
    ['key', 'ArrowUp', ['shift']],
    ['type', 'Hi'],
  ])
  good.close()
  await waitFor(() => logs.includes('CONTROL OFF'))
})

test('five bad codes lock the helper for 60 seconds', async (t) => {
  let now = 10_000
  const { helper, logs } = await boot(t, { now: () => now })
  for (let i = 0; i < 5; i++) {
    const { ws, incoming } = openSession(helper.port)
    await opened(ws)
    ws.send(JSON.stringify({ t: 'pair', code: '000000' }))
    const msg = await incoming
    assert.equal(msg.t, 'rejected')
    ws.close()
  }
  assert.ok(logs.includes('Locked for 60s after 5 bad pairing attempts'))
  const locked = openSession(helper.port)
  assert.deepEqual(await locked.incoming, { t: 'rejected', reason: 'locked' })
  locked.ws.close()

  now += 60_000
  const again = openSession(helper.port)
  await opened(again.ws)
  again.ws.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await again.incoming, { t: 'paired' })
  again.ws.close()
})

test('only one client is paired at a time', async (t) => {
  const { helper, inject } = await boot(t)
  const first = connect(helper.port)
  await opened(first)
  first.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await onceMessage(first), { t: 'paired' })
  const second = openSession(helper.port)
  assert.deepEqual(await second.incoming, { t: 'rejected', reason: 'busy' })
  second.ws.send(JSON.stringify({ t: 'move', dx: 30, dy: 1 }))
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(inject.calls.length, 0)
  first.send(JSON.stringify({ t: 'move', dx: 8, dy: 1 }))
  await waitFor(() => inject.calls.length === 1)
  first.close()
  await new Promise((resolve) => setTimeout(resolve, 30))
  const third = connect(helper.port)
  await opened(third)
  third.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await onceMessage(third), { t: 'paired' })
  third.close()
})

test('a taken port falls through to the next loopback port', async (t) => {
  const blocker = createServer()
  await new Promise((resolve) => blocker.listen(0, LOOPBACK, resolve))
  const busy = blocker.address().port
  t.after(() => new Promise((resolve) => blocker.close(() => resolve())))
  const { helper } = await boot(t, { ports: [busy, 0] })
  assert.notEqual(helper.port, busy)
  assert.equal(helper.host, LOOPBACK)
})

test('localhost dev origin can pair', async (t) => {
  const { helper } = await boot(t)
  const ws = connect(helper.port, 'http://localhost:5173')
  await opened(ws)
  ws.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await onceMessage(ws), { t: 'paired' })
  ws.close()
})
