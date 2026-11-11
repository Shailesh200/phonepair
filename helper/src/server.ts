import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { codesMatch, createGate, isLocked, noteFailure, noteSuccess, type Gate } from './auth.js'
import { originAllowed, parseInput, parseJson, parsePair, type InputMsg, type Mod } from './validate.js'

export const LOOPBACK = '127.0.0.1'
export const DEFAULT_PORTS = [47811, 47812, 47813, 47814]
/** A button we pressed is released when no input arrives for this long. */
export const BUTTON_GAP_MS = 3000

export type Injector = {
  move(dx: number, dy: number): Promise<void>
  click(btn: 'left' | 'right'): Promise<void>
  scroll(dx: number, dy: number): Promise<void>
  key(key: string, mods: Mod[]): Promise<void>
  type(text: string): Promise<void>
  abs(x: number, y: number): Promise<void>
  btn(btn: 'left' | 'right', state: 'down' | 'up'): Promise<void>
  dbl(): Promise<void>
  /** Release the button this session pressed. No-op when nothing is held. */
  release(): Promise<void>
}

export type RunningHelper = {
  port: number
  host: typeof LOOPBACK
  close(): Promise<void>
}

export type StartOptions = {
  code: string
  inject: Injector
  ports?: number[]
  log?: (line: string) => void
  now?: () => number
  authTimeoutMs?: number
  gapMs?: number
}

const REJECT_REASON = ['code', 'locked', 'busy'] as const
type RejectReason = (typeof REJECT_REASON)[number]

function originOf(req: IncomingMessage): string | undefined {
  const value = req.headers.origin
  return typeof value === 'string' ? value : undefined
}

function writePreflight(req: IncomingMessage, res: ServerResponse) {
  const origin = originOf(req)
  if (!originAllowed(origin) || !origin) {
    res.writeHead(403, { 'Content-Length': '0', Connection: 'close' })
    res.end()
    return
  }
  const requested = req.headers['access-control-request-headers']
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
    'Content-Length': '0',
  }
  if (typeof requested === 'string' && requested.length > 0 && requested.length < 512) {
    headers['Access-Control-Allow-Headers'] = requested
  }
  res.writeHead(204, headers)
  res.end()
}

function rejectUpgrade(socket: Duplex) {
  const body = 'origin'
  socket.write([
    'HTTP/1.1 403 Forbidden',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n'))
  socket.destroy()
}

function asText(data: RawData): string | null {
  if (typeof data === 'string') return data
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return null
}

function sendJson(ws: WebSocket, body: object) {
  if (ws.readyState !== ws.OPEN) return
  ws.send(JSON.stringify(body))
}

function rejectClient(ws: WebSocket, reason: RejectReason) {
  const body = JSON.stringify({ t: 'rejected', reason })
  const close = () => {
    try { ws.close(1008, reason) } catch { /* already closing */ }
  }
  if (ws.readyState !== ws.OPEN) {
    close()
    return
  }
  ws.send(body, () => close())
}

async function apply(inject: Injector, msg: InputMsg) {
  switch (msg.t) {
    case 'move':
      await inject.move(msg.dx, msg.dy)
      return
    case 'click':
      await inject.click(msg.btn)
      return
    case 'scroll':
      await inject.scroll(msg.dx, msg.dy)
      return
    case 'key':
      await inject.key(msg.key, msg.mods)
      return
    case 'type':
      await inject.type(msg.text)
      return
    case 'abs':
      await inject.abs(msg.x, msg.y)
      return
    case 'btn':
      await inject.btn(msg.btn, msg.state)
      return
    case 'dbl':
      await inject.dbl()
      return
  }
}

function listenOn(server: Server, ports: number[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (index: number) => {
      if (index >= ports.length) {
        reject(new Error(`Could not listen on ${LOOPBACK} (ports ${ports.join(', ')})`))
        return
      }
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          attempt(index + 1)
          return
        }
        reject(err)
      }
      server.once('error', onError)
      server.listen(ports[index], LOOPBACK, () => {
        server.off('error', onError)
        const addr = server.address()
        if (!addr || typeof addr === 'string' || addr.address !== LOOPBACK) {
          reject(new Error('Helper refused a non-loopback address'))
          return
        }
        resolve(addr.port)
      })
    }
    attempt(0)
  })
}

export async function startHelper(opts: StartOptions): Promise<RunningHelper> {
  if (!/^\d{6}$/.test(opts.code)) throw new Error('Pairing code must be 6 digits')
  const log = opts.log ?? ((line) => console.log(line))
  const now = opts.now ?? (() => Date.now())
  const authTimeoutMs = opts.authTimeoutMs ?? 5000
  const gapMs = opts.gapMs ?? BUTTON_GAP_MS
  const gate: Gate = createGate()
  let active: WebSocket | null = null
  let paired = false
  let warned = false
  let heldBtn: 'left' | 'right' | null = null
  let gapTimer: ReturnType<typeof setTimeout> | null = null

  const clearGap = () => {
    if (!gapTimer) return
    clearTimeout(gapTimer)
    gapTimer = null
  }

  const failInput = () => {
    if (warned) return
    warned = true
    log('Input was rejected by the operating system. On macOS, grant Accessibility in System Settings > Privacy & Security > Accessibility.')
  }

  const releaseHeld = () => {
    clearGap()
    heldBtn = null
    if (!paired) return
    void opts.inject.release().catch(failInput)
  }

  const armGap = () => {
    clearGap()
    if (!heldBtn) return
    gapTimer = setTimeout(() => {
      gapTimer = null
      releaseHeld()
    }, gapMs)
  }

  const noteInput = (msg: InputMsg) => {
    if (msg.t === 'btn' && msg.state === 'down') {
      heldBtn = msg.btn
      armGap()
      return
    }
    if (msg.t === 'btn' && msg.state === 'up' && heldBtn === msg.btn) {
      heldBtn = null
      clearGap()
      return
    }
    if (heldBtn) armGap()
  }

  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      writePreflight(req, res)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': '0' })
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 })
  wss.on('headers', (headers, req) => {
    const origin = originOf(req)
    if (!originAllowed(origin) || !origin) return
    headers.push(`Access-Control-Allow-Origin: ${origin}`)
    headers.push('Access-Control-Allow-Private-Network: true')
    headers.push('Vary: Origin')
  })

  const controlOff = () => {
    if (!paired) return
    paired = false
    log('CONTROL OFF')
  }

  server.on('upgrade', (req, socket, head) => {
    if (!originAllowed(originOf(req))) {
      rejectUpgrade(socket)
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('error', () => {
        try { ws.close() } catch { /* ignore */ }
      })
      if (isLocked(gate, now())) {
        rejectClient(ws, 'locked')
        return
      }
      if (active) {
        rejectClient(ws, 'busy')
        return
      }
      active = ws
      let authed = false
      let settled = false
      const authTimer = setTimeout(() => {
        if (!authed) failAuth()
      }, authTimeoutMs)

      const failAuth = () => {
        if (settled) return
        settled = true
        clearTimeout(authTimer)
        noteFailure(gate, now())
        const reason: RejectReason = isLocked(gate, now()) ? 'locked' : 'code'
        if (reason === 'locked') log('Locked for 60s after 5 bad pairing attempts')
        if (active === ws) active = null
        rejectClient(ws, reason)
      }

      ws.on('close', () => {
        clearTimeout(authTimer)
        if (active === ws) {
          active = null
          // Disconnect and unpair both close this single session.
          releaseHeld()
          controlOff()
        }
      })

      ws.on('message', (data, isBinary) => {
        if (!authed) {
          if (isBinary) {
            failAuth()
            return
          }
          const text = asText(data)
          const parsed = text === null ? { ok: false as const } : parseJson(text)
          const pair = parsed.ok ? parsePair(parsed.msg) : { ok: false as const }
          if (!pair.ok || !codesMatch(pair.msg.code, opts.code)) {
            failAuth()
            return
          }
          if (settled) return
          settled = true
          clearTimeout(authTimer)
          authed = true
          paired = true
          noteSuccess(gate)
          log('CONTROL ON (paired)')
          sendJson(ws, { t: 'paired' })
          return
        }
        if (isBinary) return
        const text = asText(data)
        if (text === null) return
        const parsed = parseJson(text)
        if (!parsed.ok) return
        const input = parseInput(parsed.msg)
        if (!input.ok) return
        noteInput(input.msg)
        void apply(opts.inject, input.msg).catch(failInput)
      })
    })
  })

  let port: number
  try {
    port = await listenOn(server, opts.ports ?? DEFAULT_PORTS)
  } catch (err) {
    server.close()
    throw err
  }
  server.on('error', () => log('Helper network error'))

  return {
    port,
    host: LOOPBACK,
    close() {
      clearGap()
      heldBtn = null
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(), 1000)
        for (const client of wss.clients) {
          try { client.close() } catch { /* ignore */ }
        }
        wss.close()
        server.close(() => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}
