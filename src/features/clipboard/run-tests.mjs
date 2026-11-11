import * as esbuild from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')
const outfile = join(root, 'node_modules/.cache/clipboard-tests.mjs')
mkdirSync(dirname(outfile), { recursive: true })
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(here, 'clipboard.test.tsx')],
  bundle: true,
  packages: 'external',
  format: 'esm',
  platform: 'node',
  outfile,
  jsx: 'automatic',
  define: {
    __INDEX_SRC__: JSON.stringify(readFileSync(join(here, 'index.tsx'), 'utf8')),
    __LOGIC_SRC__: JSON.stringify(readFileSync(join(here, 'logic.ts'), 'utf8')),
  },
})
const mod = await import(pathToFileURL(outfile).href + '?t=' + Date.now())
try {
  await mod.runClipboardTests()
} catch (err) {
  console.error(err)
  process.exit(1)
}
console.log('clipboard tests passed')
