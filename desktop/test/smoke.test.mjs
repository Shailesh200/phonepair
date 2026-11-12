import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

const require = createRequire(import.meta.url)
const { DEFAULT_PORTS, startHelperApp } = require('../out/session.cjs')
const WebSocket = createRequire(new URL('../../helper/package.json', import.meta.url))('ws')

function injector() {
  const noop = async () => {}
  return {
    async move() { await noop() },
    async click() { await noop() },
    async scroll() { await noop() },
    async key() { await noop() },
    async type() { await noop() },
    async abs() { await noop() },
    async btn() { await noop() },
    async dbl() { await noop() },
    async release() { await noop() },
  }
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

describe('phonepair helper app', { concurrency: 1 }, () => {
test('main logic listens on 47811 and prints a 6-digit code', async (t) => {
  const lines = []
  const orig = console.log
  console.log = (...args) => {
    lines.push(args.map(String).join(' '))
  }
  t.after(() => { console.log = orig })

  const running = await startHelperApp({ packaged: false, inject: injector() })
  t.after(() => running.close())

  assert.deepEqual([...DEFAULT_PORTS], [47811, 47812, 47813, 47814])
  assert.equal(running.port, 47811)
  assert.equal(running.host, '127.0.0.1')
  assert.match(running.code, /^\d{6}$/)
  assert.equal(running.status(), 'waiting')
  assert.ok(lines.some((line) => line === `Listening on 127.0.0.1:${running.port}`))
  assert.ok(lines.some((line) => line === `Pairing code: ${running.code}`))

  const ws = new WebSocket(`ws://127.0.0.1:${running.port}`, {
    headers: { origin: 'https://phonepair.vercel.app' },
  })
  t.after(() => { try { ws.close() } catch { /* already closed */ } })
  const incoming = onceMessage(ws)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  ws.send(JSON.stringify({ t: 'pair', code: running.code }))
  assert.deepEqual(await incoming, { t: 'paired' })
  assert.equal(running.status(), 'connected')

  const stopped = await running.stop()
  assert.equal(stopped.status, 'waiting')
  assert.equal(stopped.code, running.code)
  assert.equal(stopped.port, 47811)
  assert.equal(running.status(), 'waiting')
})

test('packaged main logic ignores PHONEPAIR_DEV', async () => {
  const scriptUrl = new URL('./packaged-origin.mjs', import.meta.url)
  const child = spawn(process.execPath, [fileURLToPath(scriptUrl)], {
    env: { ...process.env, PHONEPAIR_DEV: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.on('data', (chunk) => { out += chunk })
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', resolve)
  })
  assert.equal(code, 0, out)
  assert.match(out, /Pairing code: \d{6}/)
  assert.match(out, /Listening on 127\.0\.0\.1:47811/)
})

test('window copy and builder ids stay fixed', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8')
  const html = readFileSync(new URL('../src/window.html', import.meta.url), 'utf8')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const remote = readFileSync(new URL('../../src/features/remote/index.tsx', import.meta.url), 'utf8')
  assert.match(main, /systemPreferences\.isTrustedAccessibilityClient\(false\)/)
  assert.match(main, /packaged: app\.isPackaged/)
  assert.ok(main.includes('Allow PhonePair Helper in System Settings > Privacy & Security > Accessibility'))
  assert.ok(main.includes('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'))
  assert.ok(html.includes('>Stop<'))
  assert.ok(html.includes('>Quit<'))
  assert.equal(pkg.build.appId, 'com.shailesh200.phonepair.helper')
  assert.equal(pkg.build.productName, 'PhonePair Helper')
  assert.equal(pkg.build.directories.buildResources, 'build')
  assert.equal(pkg.build.mac.icon, 'build/icon.icns')
  assert.equal(pkg.build.win.icon, 'build/icon.ico')
  const icns = readFileSync(new URL('../build/icon.icns', import.meta.url))
  const ico = readFileSync(new URL('../build/icon.ico', import.meta.url))
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns')
  assert.equal(icns.readUInt32BE(4), icns.length)
  assert.equal(ico.readUInt16LE(0), 0)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.ok(ico.readUInt16LE(4) >= 1)
  assert.equal(pkg.build.mac.hardenedRuntime, true)
  assert.equal(pkg.build.mac.notarize, true)
  assert.equal(pkg.scripts.postinstall, 'electron-builder install-app-deps')
  assert.ok(remote.includes('Download the PhonePair Helper, open it, and type the 6-digit code it shows.'))
  assert.ok(remote.includes('>Download for Mac<'))
  assert.ok(remote.includes('>Download for Windows<'))
  assert.ok(remote.includes('https://github.com/Shailesh200/phonepair/releases/latest/download/PhonePair-Helper-mac.dmg'))
  assert.ok(remote.includes('https://github.com/Shailesh200/phonepair/releases/latest/download/PhonePair-Helper-win.exe'))
  assert.ok(remote.includes('Open the DMG, drag PhonePair Helper to Applications, and open it. Allow Accessibility when asked so Control works.'))
  assert.ok(remote.includes('If SmartScreen appears, click More info, then Run anyway.'))
  assert.ok(remote.includes('or run from source: <code>cd helper && npm start</code>'))
  assert.equal(remote.includes('Pointer, clicks, scroll, and keys from your phone stay inside this tab.'), false)
})
})
