import { randomInt } from 'node:crypto'
import { createNutInjector, nutNoop, releaseModifiers } from './inject.js'
import { ACCESSIBILITY_HELP, checkWithOsascript, probeInput } from './permission.js'
import { LOOPBACK, startHelper } from './server.js'

function pairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

async function macAccessibility(): Promise<boolean> {
  const scriptOk = await checkWithOsascript()
  if (!scriptOk) return false
  return Promise.race([
    probeInput(nutNoop),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
  ])
}

async function main() {
  if (process.platform === 'darwin') {
    const allowed = await macAccessibility()
    if (!allowed) {
      console.log(ACCESSIBILITY_HELP)
      console.log('')
    }
  }

  const code = pairingCode()
  const inject = createNutInjector()
  const helper = await startHelper({ code, inject })
  console.log(`Listening on ${LOOPBACK}:${helper.port}`)
  console.log(`Pairing code: ${code}`)
  console.log('CONTROL OFF')

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await helper.close()
    await Promise.race([
      Promise.all([inject.release(), releaseModifiers()]),
      new Promise((resolve) => setTimeout(resolve, 400)),
    ])
    process.exit(0)
  }
  process.on('SIGINT', () => { void stop() })
  process.on('SIGTERM', () => { void stop() })
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'Helper failed to start'
  console.error(message)
  process.exit(1)
})
