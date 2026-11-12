import { createRequire } from 'node:module'

const { startHelperApp } = createRequire(import.meta.url)('../out/session.cjs')

const noop = async () => {}
const inject = {
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

process.env.PHONEPAIR_DEV = '1'
const running = await startHelperApp({ packaged: true, inject })
process.env.PHONEPAIR_DEV = '1'

const dev = await fetch(`http://127.0.0.1:${running.port}/`, {
  method: 'OPTIONS',
  headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
})
const prod = await fetch(`http://127.0.0.1:${running.port}/`, {
  method: 'OPTIONS',
  headers: { Origin: 'https://phonepair.vercel.app', 'Access-Control-Request-Method': 'GET' },
})
await running.close()

if (running.port !== 47811) {
  console.error('expected port 47811, got', running.port)
  process.exit(2)
}
if (!/^\d{6}$/.test(running.code)) {
  console.error('expected a 6-digit code, got', running.code)
  process.exit(3)
}
if (dev.status !== 403) {
  console.error('dev origin status', dev.status)
  process.exit(4)
}
if (prod.status !== 204) {
  console.error('production origin status', prod.status)
  process.exit(5)
}
