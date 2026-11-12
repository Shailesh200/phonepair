// esbuild is provided by vite (transitive dependency — not listed in package.json).
import * as esbuild from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = join(root, 'src')
const tsxCache = join(root, 'node_modules/.cache/pairing-tsx-tests')

function collectTests(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...collectTests(p))
    else if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) out.push(p)
  }
  return out.sort()
}

async function bundleTsxTest(entry) {
  mkdirSync(tsxCache, { recursive: true })
  const out = join(tsxCache, basename(entry).replace(/\.tsx$/, '.mjs'))
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    packages: 'external',
    format: 'esm',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
  })
  return out
}

function runNodeTest(files) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--test', ...files], {
      stdio: 'inherit',
      cwd: root,
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

function runScript(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit', cwd: root })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

const all = collectTests(src)
const tsFiles = all.filter((f) => f.endsWith('.test.ts'))
const tsxFiles = all.filter((f) => f.endsWith('.test.tsx'))

const clipboardTest = join(src, 'features/clipboard/clipboard.test.tsx')
const tsxForBundle = tsxFiles.filter((f) => f !== clipboardTest)

const bundled = []
for (const entry of tsxForBundle) {
  bundled.push(await bundleTsxTest(entry))
}

let code = await runNodeTest([...tsFiles, ...bundled])
if (code !== 0) process.exit(code)

if (tsxFiles.includes(clipboardTest)) {
  code = await runScript(join(src, 'features/clipboard/run-tests.mjs'))
}

process.exit(code ?? 0)
