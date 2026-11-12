/** How long to wait for one helper port before treating it as down.
 * The first port of the first connect attempt waits 15s so Chrome's
 * local-network Allow prompt can be accepted. Every later port and attempt stays at 900ms.
 */
export function helperProbeTimeout(attempt: number, portIndex: number): number {
  return attempt === 0 && portIndex === 0 ? 15000 : 900
}

export type HelperProbeResult = 'connected' | 'rejected' | 'down'

export type HelperProbeSocket = {
  send: (data: string) => void
  close: () => void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
}

/** Pair with one helper socket. `error` and `close` settle immediately; only silence waits out `timeoutMs`. */
export function settleHelperProbe(args: {
  code: string
  mine: number
  currentJob: () => number
  timeoutMs: number
  socket: HelperProbeSocket
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (id: number) => void
  onPaired: (socket: HelperProbeSocket) => void
}): Promise<HelperProbeResult> {
  const { socket: ws } = args
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: HelperProbeResult) => {
      if (settled) return
      settled = true
      args.clearTimer(timer)
      if (result !== 'connected') {
        ws.onopen = null
        ws.onmessage = null
        ws.onerror = null
        ws.onclose = null
        try { ws.close() } catch { /* ignore */ }
      }
      resolve(result)
    }
    const timer = args.setTimer(() => finish('down'), args.timeoutMs)
    ws.onerror = () => finish('down')
    ws.onclose = () => finish('down')
    ws.onopen = () => {
      if (args.mine !== args.currentJob()) { finish('down'); return }
      try { ws.send(JSON.stringify({ t: 'pair', code: args.code })) } catch { finish('down') }
    }
    const onProbeMessage = (ev: { data: unknown }) => {
      let msg: { t?: string } = {}
      try { msg = JSON.parse(String(ev.data)) as { t?: string } } catch { finish('rejected'); return }
      if (msg.t === 'paired' && args.mine === args.currentJob()) {
        ws.onerror = null
        args.onPaired(ws)
        if (ws.onmessage === onProbeMessage) ws.onmessage = null
        finish('connected')
        return
      }
      finish(msg.t === 'rejected' ? 'rejected' : 'down')
    }
    ws.onmessage = onProbeMessage
  })
}
