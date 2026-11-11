'use strict'

const fs = require('fs')
const path = require('path')

const KEEP = {
  darwin: 'libnut-darwin',
  win32: 'libnut-win32',
  linux: 'libnut-linux',
}

function collectForeignPrebuilds(dir, keep, found) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    let stat
    try {
      stat = fs.lstatSync(full)
    } catch {
      continue
    }
    if (!stat.isDirectory()) continue
    if (name.startsWith('libnut-') && name !== 'libnut') {
      if (name !== keep) found.push(full)
      continue
    }
    collectForeignPrebuilds(full, keep, found)
  }
}

/** Drop nut-js native builds for other operating systems after the app is packed. */
module.exports = async function afterPack(context) {
  const keep = KEEP[context.electronPlatformName]
  if (!keep) return
  const found = []
  collectForeignPrebuilds(context.appOutDir, keep, found)
  for (const dir of found) fs.rmSync(dir, { recursive: true, force: true })
}
