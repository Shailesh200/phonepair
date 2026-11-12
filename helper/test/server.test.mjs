import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import WebSocket from 'ws'
import { BUTTON_GAP_MS, LOOPBACK, startHelper } from '../dist/server.js'

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
    async abs(x, y) { calls.push(['abs', x, y]) },
    async btn(btn, state) { calls.push(['btn', btn, state]) },
    async dbl() { calls.push(['dbl']) },
    async release() { calls.push(['release']) },
    async nudge() { calls.push(['nudge']) },
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
    gapMs: opts.gapMs,
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
  const prev = process.env.PHONEPAIR_DEV
  t.after(() => {
    if (prev === undefined) delete process.env.PHONEPAIR_DEV
    else process.env.PHONEPAIR_DEV = prev
  })
  delete process.env.PHONEPAIR_DEV
  const local = await fetch(`http://${LOOPBACK}:${helper.port}`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
  })
  assert.equal(local.status, 403)
  assert.equal(local.headers.get('access-control-allow-private-network'), null)
  process.env.PHONEPAIR_DEV = '1'
  const dev = await fetch(`http://${LOOPBACK}:${helper.port}`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
  })
  assert.equal(dev.status, 204)
  assert.equal(dev.headers.get('access-control-allow-private-network'), 'true')
  delete process.env.PHONEPAIR_DEV
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

test('absolute points are clamped and unknown buttons are dropped', async (t) => {
  const { helper, inject } = await boot(t)
  const ws = connect(helper.port)
  await opened(ws)
  ws.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await onceMessage(ws), { t: 'paired' })
  ws.send(JSON.stringify({ t: 'abs', x: -4, y: 0.25 }))
  ws.send(JSON.stringify({ t: 'btn', btn: 'middle', state: 'down' }))
  ws.send(JSON.stringify({ t: 'btn', btn: 'left', state: 'nope' }))
  ws.send(JSON.stringify({ t: 'dbl' }))
  ws.send(JSON.stringify({ t: 'file', path: '/etc/passwd' }))
  await waitFor(() => inject.calls.length >= 2)
  assert.deepEqual(inject.calls, [
    ['abs', 0, 0.25],
    ['dbl'],
  ])
  ws.close()
})

test('a held button is released on disconnect and unpair', async (t) => {
  const { helper, inject, logs } = await boot(t)
  const ws = connect(helper.port)
  await opened(ws)
  ws.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await onceMessage(ws), { t: 'paired' })
  ws.send(JSON.stringify({ t: 'btn', btn: 'left', state: 'down' }))
  await waitFor(() => inject.calls.some((call) => call[0] === 'btn'))
  assert.equal(inject.calls.some((call) => call[0] === 'release'), false)
  ws.close()
  await waitFor(() => inject.calls.some((call) => call[0] === 'release'))
  await waitFor(() => logs.includes('CONTROL OFF'))
  assert.equal(helper.host, LOOPBACK)
})

test('a held button is released after a message gap', async (t) => {
  assert.equal(BUTTON_GAP_MS, 3000)
  const gapMs = 350
  const { helper, inject } = await boot(t, { gapMs })
  const ws = connect(helper.port)
  await opened(ws)
  ws.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await onceMessage(ws), { t: 'paired' })
  ws.send(JSON.stringify({ t: 'btn', btn: 'right', state: 'down' }))
  await waitFor(() => inject.calls.some((call) => call[0] === 'btn'))
  const mark = Date.now()
  ws.send(JSON.stringify({ t: 'abs', x: 0.5, y: 0.5 }))
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(inject.calls.some((call) => call[0] === 'release'), false)
  await waitFor(() => inject.calls.some((call) => call[0] === 'release'), 1000)
  assert.ok(Date.now() - mark >= gapMs - 50)
  ws.close()
})

test('localhost dev origin can pair only when PHONEPAIR_DEV=1', async (t) => {
  const prev = process.env.PHONEPAIR_DEV
  t.after(() => {
    if (prev === undefined) delete process.env.PHONEPAIR_DEV
    else process.env.PHONEPAIR_DEV = prev
  })
  delete process.env.PHONEPAIR_DEV
  const { helper } = await boot(t)
  const blocked = connect(helper.port, 'http://localhost:5173')
  const blockedResult = await new Promise((resolve) => {
    blocked.once('open', () => resolve('open'))
    blocked.once('error', () => resolve('error'))
    blocked.once('unexpected-response', () => resolve('unexpected'))
  })
  assert.notEqual(blockedResult, 'open')
  process.env.PHONEPAIR_DEV = '1'
  const ws = connect(helper.port, 'http://localhost:5173')
  await opened(ws)
  ws.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await onceMessage(ws), { t: 'paired' })
  ws.close()
})

function moverClock() {
  const timers = []
  return {
    setTimer(fn, ms) {
      const timer = { fn, ms, left: ms }
      timers.push(timer)
      return timer
    },
    clearTimer(timer) {
      const index = timers.indexOf(timer)
      if (index >= 0) timers.splice(index, 1)
    },
    tick(ms) {
      let left = ms
      let guard = 0
      while (left > 0 && timers.length && guard < 100000) {
        guard += 1
        const step = Math.min(left, ...timers.map((timer) => timer.left))
        for (const timer of timers) timer.left -= step
        left -= step
        for (const timer of timers.filter((item) => item.left <= 0)) {
          timer.left += timer.ms
          timer.fn()
        }
      }
    },
  }
}

function takeMessages(ws) {
  const queue = []
  const waiters = []
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data))
    const waiter = waiters.shift()
    if (waiter) waiter(msg)
    else queue.push(msg)
  })
  return () => {
    const next = queue.shift()
    if (next) return Promise.resolve(next)
    return new Promise((resolve) => { waiters.push(resolve) })
  }
}

test('mover reports on connect, rejects a bad interval, and stops on unpair', async (t) => {
  const clock = moverClock()
  const inject = injector()
  const logs = []
  const helper = await startHelper({
    code: '042817',
    inject,
    ports: [0],
    log: (line) => logs.push(line),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  t.after(() => helper.close())
  const ws = connect(helper.port)
  const next = takeMessages(ws)
  await opened(ws)
  ws.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await next(), { t: 'paired' })
  assert.deepEqual(await next(), { t: 'mover', on: false, interval: null })
  ws.send(JSON.stringify({ t: 'mover', on: true, interval: '10s' }))
  ws.send(JSON.stringify({ t: 'mover', on: true, interval: '2m' }))
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(inject.calls.some((call) => call[0] === 'nudge'), false)
  ws.send(JSON.stringify({ t: 'mover', on: true, interval: '30s' }))
  assert.deepEqual(await next(), { t: 'mover', on: true, interval: '30s' })
  clock.tick(29_999)
  assert.equal(inject.calls.filter((call) => call[0] === 'nudge').length, 0)
  clock.tick(1)
  assert.equal(inject.calls.filter((call) => call[0] === 'nudge').length, 1)
  ws.send(JSON.stringify({ t: 'mover', on: true, interval: '1m' }))
  assert.deepEqual(await next(), { t: 'mover', on: true, interval: '1m' })
  clock.tick(30_000)
  assert.equal(inject.calls.filter((call) => call[0] === 'nudge').length, 1)
  clock.tick(30_000)
  assert.equal(inject.calls.filter((call) => call[0] === 'nudge').length, 2)
  ws.close()
  await waitFor(() => logs.includes('CONTROL OFF'))
  const nudges = inject.calls.filter((call) => call[0] === 'nudge').length
  clock.tick(300_000)
  assert.equal(inject.calls.filter((call) => call[0] === 'nudge').length, nudges)
  helper.stopMover()
  clock.tick(300_000)
  assert.equal(inject.calls.filter((call) => call[0] === 'nudge').length, nudges)
})

test('sc:stop leaves the mover on, and unpair stops it', async (t) => {
  const clock = moverClock()
  const inject = injector()
  const logs = []
  const helper = await startHelper({
    code: '042817',
    inject,
    ports: [0],
    log: (line) => logs.push(line),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  t.after(() => helper.close())
  const ws = connect(helper.port)
  const next = takeMessages(ws)
  await opened(ws)
  ws.send(JSON.stringify({ t: 'pair', code: '042817' }))
  assert.deepEqual(await next(), { t: 'paired' })
  assert.deepEqual(await next(), { t: 'mover', on: false, interval: null })
  ws.send(JSON.stringify({ t: 'mover', on: true, interval: '30s' }))
  assert.deepEqual(await next(), { t: 'mover', on: true, interval: '30s' })
  ws.send(JSON.stringify({ t: 'sc:stop' }))
  await new Promise((resolve) => setTimeout(resolve, 40))
  clock.tick(30_000)
  assert.equal(inject.calls.filter((call) => call[0] === 'nudge').length, 1)
  clock.tick(30_000)
  assert.equal(inject.calls.filter((call) => call[0] === 'nudge').length, 2)
  ws.close()
  await waitFor(() => logs.includes('CONTROL OFF'))
  const nudges = inject.calls.filter((call) => call[0] === 'nudge').length
  clock.tick(300_000)
  assert.equal(inject.calls.filter((call) => call[0] === 'nudge').length, nudges)
})
