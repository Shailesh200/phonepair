import { spawn } from 'node:child_process'

const child = spawn(process.execPath, [
  '--experimental-strip-types',
  '--test',
  'src/features/pairing/pairing.test.ts',
  'src/features/screen/map.test.ts',
  'src/features/screen/control.test.ts',
  'src/remember/remember.test.ts',
  'src/remember/linkRemember.test.ts',
  'src/remember/mutualAuth.test.ts',
  'src/remember/guestFail.test.ts',
  'src/remember/linkPromote.test.ts',
], { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname })

child.on('exit', (code) => process.exit(code ?? 1))
