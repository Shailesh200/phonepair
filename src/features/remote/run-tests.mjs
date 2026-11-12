import * as esbuild from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../..')
const outfile = join(root, 'node_modules/.cache/remote-tests.mjs')
mkdirSync(dirname(outfile), { recursive: true })
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(here, 'remote.test.tsx')],
  bundle: true,
  packages: 'external',
  format: 'esm',
  platform: 'node',
  outfile,
  jsx: 'automatic',
  define: {
    __REMOTE_SRC__: JSON.stringify(readFileSync(join(here, 'Remote.tsx'), 'utf8')),
    __INDEX_SRC__: JSON.stringify(readFileSync(join(here, 'index.tsx'), 'utf8')),
    __SEND_SRC__: JSON.stringify(readFileSync(join(here, 'send.ts'), 'utf8')),
    __MODE_SRC__: JSON.stringify(readFileSync(join(here, 'mode.ts'), 'utf8')),
  },
})
await import(pathToFileURL(outfile).href + '?t=' + Date.now())
