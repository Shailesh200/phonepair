'use strict'

const fs = require('fs')
const path = require('path')

const KEEP = {
  darwin: 'libnut-darwin',
  win32: 'libnut-win32',
  linux: 'libnut-linux',
}

/**
 * Remove other platforms' nut-js prebuilds before they are copied into the asar.
 * Deleting them after packing breaks the universal macOS merge.
 */
module.exports = async function beforePack(context) {
  const keep = KEEP[context.electronPlatformName]
  const projectDir = context.packager && context.packager.projectDir
  if (!keep || !projectDir) return
  const base = path.join(projectDir, 'node_modules', '@nut-tree-fork')
  if (!fs.existsSync(base)) return
  for (const name of fs.readdirSync(base)) {
    if (!name.startsWith('libnut-') || name === 'libnut' || name === keep) continue
    fs.rmSync(path.join(base, name), { recursive: true, force: true })
  }
}
