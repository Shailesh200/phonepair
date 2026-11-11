import Peer, { DataConnection, MediaConnection } from 'peerjs'

import type { Role } from './bus'
export type { Role }
export type Status = 'starting' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed'

const SIGNAL = { host: 'signal.167.233.223.123.sslip.io', port: 443, path: '/peerjs', secure: true, key: 'peerjs' }
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHA[b % ALPHA.length]).join('')
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
const peerIdFor = (code: string) => 'phonepair-' + code.toLowerCase()

export function deviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
  if (/Mac OS X/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  if (/CrOS/.test(ua)) return 'Chromebook'
  if (/Linux/.test(ua)) return 'Linux computer'
  return 'Device'
}
export const isPhoneUA = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)

async function iceConfig(): Promise<RTCConfiguration> {
  const relay = new URLSearchParams(location.search).get('relay') === '1'
  let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
  try {
    const r = await fetch('/api/turn', { cache: 'no-store' })
    if (r.ok) iceServers = (await r.json()).iceServers
  } catch {}
  return { iceServers, iceTransportPolicy: relay ? 'relay' : 'all' }
}

type Listener = () => void
type MsgHandler = (m: any) => void
type CallHandler = (c: MediaConnection) => void

export class Link {
  role: Role
  code: string
  status: Status = 'starting'
  error = ''
  remoteName = ''
  peer: Peer | null = null
  conn: DataConnection | null = null
  private listeners = new Set<Listener>()
  private msgHandlers = new Set<MsgHandler>()
  private callHandlers = new Set<CallHandler>()
  private lastSeen = 0
  private timers: number[] = []
  private retry = 0
  private destroyed = false
  private everConnected = false

  constructor(role: Role, code: string) {
    this.role = role
    this.code = code
  }
  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  onMessage(h: MsgHandler) { this.msgHandlers.add(h); return () => { this.msgHandlers.delete(h) } }
  onCall(h: CallHandler) { this.callHandlers.add(h); return () => { this.callHandlers.delete(h) } }
  private set(s: Partial<Link>) { Object.assign(this, s); this.listeners.forEach((l) => l()) }

  async start() {
    const config = await iceConfig()
    if (this.destroyed) return
    const id = this.role === 'host' ? peerIdFor(this.code) : undefined
    const peer = id ? new Peer(id, { ...SIGNAL, config }) : new Peer({ ...SIGNAL, config })
    this.peer = peer
    peer.on('open', () => {
      this.retry = 0
      if (this.role === 'host') this.set({ status: this.conn?.open ? 'connected' : 'waiting' })
      else this.dial()
    })
    peer.on('connection', (c) => {
      if (this.role !== 'host') { c.close(); return }
      if (this.conn && this.conn !== c) { try { this.conn.close() } catch {} }
      this.attach(c)
    })
    peer.on('call', (call) => this.callHandlers.forEach((h) => h(call)))
    peer.on('disconnected', () => {
      if (this.destroyed) return
      window.setTimeout(() => { if (!this.destroyed && peer.disconnected && !peer.destroyed) peer.reconnect() }, 1500)
    })
    peer.on('error', (e: any) => {
      const t = e?.type
      if (t === 'unavailable-id' && this.role === 'host') {
        // our code is still held by an old tab/session: retry a few times then roll a new code
        this.retry++
        peer.destroy()
        if (this.retry > 4) { this.code = newCode(); sessionStorage.setItem('pp-code', this.code); this.retry = 0 }
        window.setTimeout(() => this.start(), 2500)
        return
      }
      if (t === 'peer-unavailable') {
        this.conn = null
        this.retry++
        if (this.retry > 8 && !this.everConnected) { this.set({ status: 'error', error: 'No laptop found with that code. Check the code and try again.' }); return }
        this.set({ status: this.everConnected ? 'reconnecting' : 'connecting' })
        window.setTimeout(() => this.dial(), 2000)
        return
      }
      if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
        this.set({ status: this.everConnected ? 'reconnecting' : this.status, error: '' })
        return
      }
      console.warn('peer error', t, e)
    })
    this.timers.push(window.setInterval(() => this.tick(), 4000))
  }

  private dial() {
    if (this.destroyed || !this.peer || this.peer.disconnected) return
    if (this.conn?.open) return
    this.set({ status: this.everConnected ? 'reconnecting' : 'connecting' })
    const c = this.peer.connect(peerIdFor(this.code), { reliable: true, serialization: 'binary' })
    this.attach(c)
    window.setTimeout(() => { if (!this.destroyed && this.conn === c && !c.open) { this.conn = null; try { c.close() } catch {}; this.dial() } }, 12000)
  }

  private attach(c: DataConnection) {
    this.conn = c
    const onOpen = () => {
      this.lastSeen = Date.now()
      this.everConnected = true
      this.retry = 0
      c.send({ t: 'hello', name: deviceName() })
      this.set({ status: 'connected', error: '' })
    }
    if (c.open) onOpen(); else c.on('open', onOpen)
    c.on('data', (m: any) => {
      this.lastSeen = Date.now()
      if (!m || typeof m !== 'object') return
      if (m.t === 'ping') return
      if (m.t === 'hello') { this.set({ remoteName: m.name }); return }
      if (m.t === 'bye') { this.set({ status: this.role === 'host' ? 'waiting' : 'closed' }); try { c.close() } catch {}; return }
      this.msgHandlers.forEach((h) => h(m))
    })
    c.on('close', () => this.lost(c))
    c.on('error', () => this.lost(c))
  }

  private lost(c: DataConnection) {
    if (this.conn !== c || this.destroyed) return
    if (this.status === 'closed') return
    this.conn = null
    if (this.role === 'host') this.set({ status: 'waiting' })
    else { this.set({ status: 'reconnecting' }); window.setTimeout(() => this.dial(), 1000) }
  }

  private tick() {
    const c = this.conn
    if (c?.open) {
      try { c.send({ t: 'ping' }) } catch {}
      if (Date.now() - this.lastSeen > 15000) { try { c.close() } catch {}; this.lost(c) }
    } else if (this.role === 'guest' && this.status === 'reconnecting' && this.peer && !this.peer.disconnected) {
      this.dial()
    }
  }

  get remoteId() { return this.conn?.peer }
  get connected() { return this.status === 'connected' && !!this.conn?.open }

  send(m: any) { if (this.conn?.open) this.conn.send(m) }

  call(stream: MediaStream, kind: string) {
    if (!this.peer || !this.remoteId) throw new Error('Not connected')
    return this.peer.call(this.remoteId, stream, { metadata: { kind } })
  }

  disconnect() {
    try { this.conn?.send({ t: 'bye' }) } catch {}
    this.set({ status: this.role === 'host' ? 'waiting' : 'closed' })
    const c = this.conn
    this.conn = null
    window.setTimeout(() => { try { c?.close() } catch {} }, 200)
  }

  destroy() {
    this.destroyed = true
    this.timers.forEach(clearInterval)
    try { this.conn?.send({ t: 'bye' }) } catch {}
    this.peer?.destroy()
  }
}
