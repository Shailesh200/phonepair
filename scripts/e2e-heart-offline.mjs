#!/usr/bin/env node
/**
 * Heart cases 9/11 smoke: offline laptop + remembered phone.
 * Uses npx playwright (not a package dependency). Prints window.__ppDebug JSON.
 *
 * Usage:
 *   npm run build && node scripts/e2e-heart-offline.mjs [--offline-ms=20000]
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const offlineMs = Number(process.argv.find((a) => a.startsWith('--offline-ms='))?.split('=')[1] ?? 20_000)

async function serveDist(port) {
  const root = join(process.cwd(), 'dist')
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      try {
        const p = req.url === '/' ? '/index.html' : req.url.split('?')[0]
        const body = await readFile(join(root, p === '/' ? 'index.html' : p.replace(/^\//, '')))
        const ext = p.split('.').pop()
        const types = { html: 'text/html', js: 'application/javascript', css: 'text/css' }
        res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    })
    srv.listen(port, () => resolve(srv))
  })
}

async function main() {
  const port = 4173
  const srv = await serveDist(port)
  const url = `http://127.0.0.1:${port}/`

  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  let playwright
  try {
    playwright = require('playwright')
  } catch {
    const fallback = '/tmp/phonepair-pw/node_modules/playwright'
    playwright = require(fallback)
  }
  const { chromium } = playwright
  const browser = await chromium.launch({ headless: true })
  const laptop = await browser.newContext()
  const laptopPage = await laptop.newPage()
  await laptopPage.goto(url)

  const debugBefore = await laptopPage.evaluate(() => {
    const w = globalThis
    return w.__ppDebug ?? { note: 'no-link-yet' }
  })
  process.stdout.write(`__ppDebug_before=${JSON.stringify(debugBefore)}\n`)

  await laptop.setOffline(true)
  await laptopPage.waitForTimeout(offlineMs)
  await laptop.setOffline(false)

  await laptopPage.waitForTimeout(15_000)

  const debugAfter = await laptopPage.evaluate(() => globalThis.__ppDebug ?? { note: 'no-link-yet' })
  process.stdout.write(`__ppDebug_after=${JSON.stringify(debugAfter)}\n`)
  process.stdout.write(`offline_ms=${offlineMs} restore_wait_ms=15000\n`)

  await browser.close()
  srv.close()
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e) + '\n')
  process.exit(1)
})
