import Peer, { DataConnection, MediaConnection } from 'peerjs'

import type { Role } from './bus'
import { newPairCode, normalizePairCode, peerIdForCode } from '../features/pairing/code'
import { classifyGuestPairError, guestErrorText, lastGuestPairedCode, rememberGuestPairedCode } from '../features/pairing/errors'
import { loadRtcConfiguration } from '../features/pairing/ice'
import {
  GUEST_CONNECTING_WATCHDOG_MS,
  guestShouldRedialOnPeerOpen,
  shouldDeferDialUntilPeerOpen,
} from '../features/pairing/dialGuard'
import { guestUnavailableRetries, redialDelayMs } from '../features/pairing/reconnect'
import { rememberLastLaptop } from '../features/pairing/session'

export type { Role }
export type Status = 'starting' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed'

const SIGNAL = { host: 'signal.167.233.223.123.sslip.io', port: 443, path: '/peerjs', secure: true, key: 'peerjs' }

export { newPairCode as newCode, normalizePairCode as cleanCode } from '../features/pairing/code'

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

type Listener = () => void
type MsgHandler = (m: any) => void
type CallHandler = (c: MediaConnection) => void

export class Link {
  role: Role
  code: string
  status: Status = 'starting'
  error = ''
  remoteName = ''
  guestStallRetrying = false
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
  private pending: DataConnection | null = null
  private dialWait: number | null = null
  private hostGrace: number | null = null
  private hostFails = 0
  private connectingSince = 0
  private dialOnOpenPending = false

  constructor(role: Role, code: string) {
    this.role = role
    this.code = normalizePairCode(code)
  }
  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  onMessage(h: MsgHandler) { this.msgHandlers.add(h); return () => { this.msgHandlers.delete(h) } }
  onCall(h: CallHandler) { this.callHandlers.add(h); return () => { this.callHandlers.delete(h) } }
  private set(s: Partial<Link>) { Object.assign(this, s); this.listeners.forEach((l) => l()) }

  async start() {
    const config = await loadRtcConfiguration()
    if (this.destroyed) return
    const id = this.role === 'host' ? peerIdForCode(this.code) : undefined
    const peer = id ? new Peer(id, { ...SIGNAL, config }) : new Peer({ ...SIGNAL, config })
    this.peer = peer
    peer.on('open', () => {
      this.retry = 0
      if (this.role === 'host') this.set({ status: this.conn?.open ? 'connected' : 'waiting' })
      else if (guestShouldRedialOnPeerOpen(this.role, this.status, !!this.conn?.open)) this.dial()
    })
    peer.on('connection', (c) => {
      if (this.role !== 'host') { c.close(); return }
      if (this.conn && this.conn !== c) { try { this.conn.close() } catch {} }
      if (!c.open) this.set({ status: 'connecting' })
      this.attach(c)
    })
    peer.on('call', (call) => this.callHandlers.forEach((h) => h(call)))
    peer.on('disconnected', () => {
      if (this.destroyed) return
      this.set({ status: this.everConnected ? 'reconnecting' : this.status })
      window.setTimeout(() => { if (!this.destroyed && peer.disconnected && !peer.destroyed) peer.reconnect() }, 1500)
    })
    peer.on('error', (e: any) => {
      const t = e?.type
      if (t === 'unavailable-id' && this.role === 'host') {
        this.retry++
        peer.destroy()
        if (this.retry > 4) {
          this.set({ status: 'error', error: 'Could not claim this pairing code. Try again.' })
          return
        }
        window.setTimeout(() => this.start(), 2500)
        return
      }
      if (t === 'peer-unavailable') {
        this.closePending()
        this.conn = null
        this.retry++
        const max = guestUnavailableRetries(this.everConnected)
        if (this.retry > max && !this.everConnected) {
          const reason = classifyGuestPairError({
            code: this.code,
            everConnectedThisSession: this.everConnected,
            previouslyPairedCode: lastGuestPairedCode(),
          })
          this.set({ status: 'error', error: guestErrorText(reason) })
          return
        }
        this.set({ status: this.everConnected ? 'reconnecting' : 'connecting' })
        this.scheduleDial()
        return
      }
      if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
        if (this.role === 'host') {
          this.hostFails++
          if (this.hostFails > 3) {
            this.set({ status: 'error', error: 'Connection problem. Try again.' })
            return
          }
        }
        this.set({ status: this.everConnected ? 'reconnecting' : this.status, error: '' })
        if (this.role === 'guest' && this.peer && !this.conn?.open) this.scheduleDial()
        return
      }
      console.warn('peer error', t, e)
    })
    this.timers.push(window.setInterval(() => this.tick(), 4000))
  }

  get hadGuest() {
    return this.role === 'host' && this.everConnected
  }

  async restartHost() {
    if (this.role !== 'host' || this.destroyed) return
    this.timers.forEach(clearInterval)
    this.timers = []
    if (this.dialWait) clearTimeout(this.dialWait)
    this.dialWait = null
    if (this.hostGrace) clearTimeout(this.hostGrace)
    this.hostGrace = null
    this.closePending()
    try { this.conn?.close() } catch {}
    this.conn = null
    this.peer?.destroy()
    this.peer = null
    this.retry = 0
    this.hostFails = 0
    this.error = ''
    this.set({ status: 'starting', remoteName: '' })
    await this.start()
  }

  redialGuest() {
    if (this.role !== 'guest' || this.destroyed) return
    this.guestStallRetrying = false
    this.redialGuestNow()
  }

  private redialGuestNow() {
    if (this.role !== 'guest' || this.destroyed) return
    this.retry = 0
    if (this.dialWait) clearTimeout(this.dialWait)
    this.dialWait = null
    this.closePending()
    this.conn = null
    this.connectingSince = Date.now()
    this.set({ status: 'connecting', error: '' })
    this.dial()
  }

  async rollHostCode() {
    if (this.role !== 'host' || this.destroyed) return
    this.timers.forEach(clearInterval)
    this.timers = []
    if (this.dialWait) clearTimeout(this.dialWait)
    if (this.hostGrace) clearTimeout(this.hostGrace)
    this.hostGrace = null
    try { this.conn?.send({ t: 'bye' }) } catch {}
    try { this.conn?.close() } catch {}
    this.conn = null
    this.closePending()
    this.peer?.destroy()
    this.peer = null
    this.code = newPairCode()
    sessionStorage.setItem('pp-code', this.code)
    this.retry = 0
    this.everConnected = false
    this.set({ status: 'starting', error: '', remoteName: '' })
    await this.start()
  }

  private closePending() {
    if (!this.pending) return
    try { this.pending.close() } catch {}
    this.pending = null
  }

  private scheduleDial() {
    if (this.dialWait) return
    const delay = redialDelayMs(this.retry, this.everConnected)
    if (delay <= 0) {
      this.dial()
      return
    }
    this.dialWait = window.setTimeout(() => {
      this.dialWait = null
      this.dial()
    }, delay)
  }

  private armDialWhenPeerOpens() {
    if (!this.peer || this.dialOnOpenPending) return
    this.dialOnOpenPending = true
    const peer = this.peer
    const onReopen = () => {
      if (peer !== this.peer) return
      this.dialOnOpenPending = false
      peer.off('open', onReopen)
      if (this.destroyed) return
      if (guestShouldRedialOnPeerOpen(this.role, this.status, !!this.conn?.open)) this.dial()
    }
    peer.on('open', onReopen)
  }

  private clearGuestWatchdog() {
    this.connectingSince = 0
    this.guestStallRetrying = false
  }

  private dial() {
    if (this.destroyed) return
    if (this.conn?.open) return
    const peer = this.peer
    if (!peer || peer.destroyed) return
    if (
      shouldDeferDialUntilPeerOpen({ hasPeer: true, destroyed: peer.destroyed, disconnected: peer.disconnected })
      || !peer.open
    ) {
      this.armDialWhenPeerOpens()
      try {
        if (peer.disconnected) peer.reconnect()
      } catch {}
      if (this.role === 'guest' && !this.connectingSince) this.connectingSince = Date.now()
      return
    }
    if (this.pending && !this.pending.open) this.closePending()
    this.set({ status: this.everConnected ? 'reconnecting' : 'connecting' })
    if (this.role === 'guest' && !this.connectingSince) this.connectingSince = Date.now()
    const c = peer.connect(peerIdForCode(this.code), { reliable: true, serialization: 'binary' })
    this.pending = c
    this.attach(c)
    window.setTimeout(() => {
      if (!this.destroyed && this.conn === c && !c.open) {
        this.conn = null
        try { c.close() } catch {}
        if (this.pending === c) this.pending = null
        if (this.role === 'guest' && !this.destroyed) this.scheduleDial()
      }
    }, 12000)
  }

  private attach(c: DataConnection) {
    if (this.role === 'guest' && this.conn && this.conn !== c && this.conn.open) {
      try { c.close() } catch {}
      return
    }
    this.conn = c
    if (this.pending === c) this.pending = null
    const onOpen = () => {
      this.lastSeen = Date.now()
      this.everConnected = true
      this.retry = 0
      this.hostFails = 0
      if (this.hostGrace) { clearTimeout(this.hostGrace); this.hostGrace = null }
      c.send({ t: 'hello', name: deviceName() })
      this.set({ status: 'connected', error: '' })
      if (this.role === 'guest') {
        rememberGuestPairedCode(this.code)
        this.clearGuestWatchdog()
      }
    }
    if (c.open) onOpen(); else c.on('open', onOpen)
    c.on('data', (m: any) => {
      this.lastSeen = Date.now()
      if (!m || typeof m !== 'object') return
      if (m.t === 'ping') return
      if (m.t === 'hello') {
        this.set({ remoteName: m.name })
        if (this.role === 'guest') rememberLastLaptop(m.name, this.code)
        if (this.role === 'host' && c.open) {
          try { c.send({ t: 'hello', name: deviceName() }) } catch {}
        }
        return
      }
      if (m.t === 'bye') {
        this.set({ status: this.role === 'host' ? 'waiting' : 'closed' })
        try { c.close() } catch {}
        return
      }
      this.msgHandlers.forEach((h) => h(m))
    })
    c.on('close', () => this.lost(c))
    c.on('error', () => this.lost(c))
  }

  private lost(c: DataConnection) {
    if (this.conn !== c || this.destroyed) return
    if (this.status === 'closed') return
    this.conn = null
    if (this.role === 'host') {
      if (this.everConnected) {
        this.set({ status: 'reconnecting' })
        if (!this.hostGrace) {
          this.hostGrace = window.setTimeout(() => {
            this.hostGrace = null
            if (!this.conn?.open && !this.destroyed) this.set({ status: 'waiting' })
          }, 15000)
        }
      } else {
        this.set({ status: 'waiting' })
      }
    }
    else {
      this.set({ status: 'reconnecting' })
      this.scheduleDial()
    }
  }

  private tickGuestWatchdog() {
    if (this.role !== 'guest' || this.destroyed) return
    if (this.status !== 'connecting' || this.conn?.open) return
    if (!this.connectingSince) return
    if (Date.now() - this.connectingSince < GUEST_CONNECTING_WATCHDOG_MS) return
    this.connectingSince = Date.now()
    this.guestStallRetrying = true
    this.listeners.forEach((l) => l())
    this.redialGuestNow()
  }

  private tick() {
    this.tickGuestWatchdog()
    const c = this.conn
    if (c?.open) {
      try { c.send({ t: 'ping' }) } catch {}
      if (Date.now() - this.lastSeen > 15000) { try { c.close() } catch {}; this.lost(c) }
    } else if (this.role === 'guest' && (this.status === 'reconnecting' || this.status === 'connecting') && this.peer && !this.peer.disconnected) {
      if (!this.dialWait) this.scheduleDial()
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
    if (this.dialWait) clearTimeout(this.dialWait)
    this.clearGuestWatchdog()
    this.dialOnOpenPending = false
    this.closePending()
    try { this.conn?.send({ t: 'bye' }) } catch {}
    this.peer?.destroy()
  }
}
