import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const alias = {
  'phonepair-helper/server': path.join(root, '../helper/dist/server.js'),
  'phonepair-helper/validate': path.join(root, '../helper/dist/validate.js'),
  'phonepair-helper/inject': path.join(root, '../helper/dist/inject.js'),
}

function run(command) {
  const result = spawnSync(command, { stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm run build --prefix ../helper')
run('npx tsc -p tsconfig.json --noEmit')
rmSync('out', { recursive: true, force: true })

const external = ['electron', '@nut-tree-fork/nut-js']

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'out/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external,
  alias,
  logLevel: 'warning',
})

await build({
  entryPoints: ['src/session.ts'],
  outfile: 'out/session.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external,
  alias,
  logLevel: 'warning',
})

await build({
  entryPoints: ['src/preload.ts'],
  outfile: 'out/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  logLevel: 'warning',
})

mkdirSync('out', { recursive: true })
cpSync('src/window.html', 'out/window.html')
