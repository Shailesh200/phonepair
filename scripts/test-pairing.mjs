import { spawn } from 'node:child_process'
import * as esbuild from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const remoteDir = join(root, 'src/features/remote')
const outfile = join(root, 'node_modules/.cache/remote-tests.mjs')
mkdirSync(dirname(outfile), { recursive: true })
await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(remoteDir, 'remote.test.tsx')],
  bundle: true,
  packages: 'external',
  format: 'esm',
  platform: 'node',
  outfile,
  jsx: 'automatic',
  define: {
    __REMOTE_SRC__: JSON.stringify(readFileSync(join(remoteDir, 'Remote.tsx'), 'utf8')),
    __INDEX_SRC__: JSON.stringify(readFileSync(join(remoteDir, 'index.tsx'), 'utf8')),
    __SEND_SRC__: JSON.stringify(readFileSync(join(remoteDir, 'send.ts'), 'utf8')),
    __MODE_SRC__: JSON.stringify(readFileSync(join(remoteDir, 'mode.ts'), 'utf8')),
  },
})
const remoteTests = await import(pathToFileURL(outfile).href + '?t=' + Date.now())
try {
  await remoteTests.runRemoteTests()
} catch (err) {
  console.error(err)
  process.exit(1)
}
console.log('remote tests passed')

const child = spawn(process.execPath, [
  '--experimental-strip-types',
  '--test',
  'src/features/pairing/pairing.test.ts',
  'src/features/screen/map.test.ts',
  'src/features/screen/control.test.ts',
  'src/features/remote/helperProbe.test.ts',
], { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname })

child.on('exit', (code) => process.exit(code ?? 1))
