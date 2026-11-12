import { randomInt } from 'node:crypto'
import { DEFAULT_PORTS, LOOPBACK, startHelper, type Injector, type RunningHelper } from 'phonepair-helper/server'
import { setDevOriginEnabled } from 'phonepair-helper/validate'

export { DEFAULT_PORTS, LOOPBACK }
export type { Injector }

export type HelperStatus = 'waiting' | 'connected'

export type HelperApp = {
  code: string
  readonly port: number
  readonly host: string
  status(): HelperStatus
  close(): Promise<void>
  /** Clear the mouse-mover timer. Safe to call more than once. */
  stopMover(): void
  /** Drop the current session and listen again with the same code. */
  stop(): Promise<{ code: string; port: number; status: HelperStatus }>
}

export function pairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}

/**
 * Packaged builds force the dev origin off. Clearing the variable as well
 * covers any read that does not go through setDevOriginEnabled.
 */
export function applyPackagedOriginPolicy(packaged: boolean): void {
  setDevOriginEnabled(packaged ? false : null)
  if (packaged) delete process.env.PHONEPAIR_DEV
}

export async function startHelperApp(opts: {
  packaged: boolean
  inject: Injector
  code?: string
  onStatus?: (status: HelperStatus) => void
  log?: (line: string) => void
}): Promise<HelperApp> {
  applyPackagedOriginPolicy(opts.packaged)
  const code = opts.code ?? pairingCode()
  let status: HelperStatus = 'waiting'
  const onLog = (line: string) => {
    if (line.startsWith('CONTROL ON')) {
      status = 'connected'
      opts.onStatus?.('connected')
    } else if (line.startsWith('CONTROL OFF')) {
      status = 'waiting'
      opts.onStatus?.('waiting')
    }
    opts.log?.(line)
    console.log(line)
  }

  let helper: RunningHelper = await listen(code, opts.inject, onLog)

  return {
    code,
    get port() { return helper.port },
    get host() { return helper.host },
    status: () => status,
    stopMover() { helper.stopMover() },
    close: () => helper.close(),
    async stop() {
      helper.stopMover()
      await helper.close()
      status = 'waiting'
      opts.onStatus?.('waiting')
      helper = await listen(code, opts.inject, onLog)
      return { code, port: helper.port, status }
    },
  }
}

async function listen(code: string, inject: Injector, log: (line: string) => void): Promise<RunningHelper> {
  const helper = await startHelper({ code, inject, ports: DEFAULT_PORTS, log })
  console.log(`Listening on ${LOOPBACK}:${helper.port}`)
  console.log(`Pairing code: ${code}`)
  return helper
}
