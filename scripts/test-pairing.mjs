import { spawn } from 'node:child_process'

const child = spawn(process.execPath, [
  '--experimental-strip-types',
  '--test',
  'src/features/pairing/pairing.test.ts',
  'src/features/pairing/network.test.ts',
  'src/features/pairing/forceSignalReconnect.test.ts',
  'src/features/pairing/hostDualForceRunner.test.ts',
  'src/features/pairing/forceSignalDropHook.test.ts',
  'src/features/pairing/hostSignalStagger.test.ts',
  'src/remember/hostAuthAccept.test.ts',
  'src/remember/rememberListenClaim.test.ts',
  'src/features/pairing/guestTurnOrdering.test.ts',
  'src/features/pairing/peerForceAdapter.test.ts',
  'src/features/pairing/forceSignalConnectingGrace.test.ts',
  'src/features/screen/map.test.ts',
  'src/features/screen/control.test.ts',
  'src/features/remote/helperProbe.test.ts',
  'src/remember/remember.test.ts',
  'src/remember/linkRemember.test.ts',
  'src/remember/mutualAuth.test.ts',
  'src/remember/guestFail.test.ts',
  'src/remember/linkPromote.test.ts',
], { stdio: 'inherit', cwd: new URL('..', import.meta.url).pathname })

child.on('exit', (code) => process.exit(code ?? 1))
