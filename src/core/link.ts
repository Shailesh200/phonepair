import Peer, { DataConnection, MediaConnection } from 'peerjs'

import type { Role } from './bus'
import { newPairCode, normalizePairCode, peerIdForCode } from '../features/pairing/code'
import {
  guestFailFastOnPeerUnavailable,
  MSG_HOST_NOT_FOUND,
  MSG_REMEMBER_UNREACHABLE,
  rememberGuestPairedCode,
} from '../features/pairing/errors'
import { loadRtcConfiguration } from '../features/pairing/ice'
import {
  dialOpenTimeoutMs,
  GUEST_CONNECTING_WATCHDOG_MS,
  guestDialInFlight,
  guestShouldRedialOnPeerOpen,
  shouldDeferDialUntilPeerOpen,
} from '../features/pairing/dialGuard'
import { isRelayOnly } from '../features/pairing/relay'
import { hostUnavailableIdBackoffMs, hostUnavailableIdGiveUp } from '../features/pairing/hostClaim'
import { guestUnavailableRetries, redialDelayMs } from '../features/pairing/reconnect'
import { linkTeardownSendsBye } from '../features/pairing/teardown'
import { shouldCallPeerReconnect, shouldHostReconnect } from '../features/pairing/peerReconnect'
import { rememberLastLaptop } from '../features/pairing/session'
import { guestAcceptsRememberOk } from '../remember/guestAuth'
import { signPhoneProof } from '../remember/proof'
import { REMEMBER_PROOF_TIMEOUT_MS, type RememberGatePhase } from '../remember/gate'
import { RememberHostAuth } from '../remember/hostAuth'
import { shouldAcceptIncomingCall, shouldLinkSend } from '../remember/hostAuthSend'
import { bytesFromB64, bytesToB64, listenPeerId, randomBytes } from '../remember/ids'
import { hostHasPhones, loadHostStore, phoneKeyBytes } from '../remember/storage'
import type { SavedLaptop } from '../remember/storage'

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
  private inFlightDialUntil = 0
  private inFlightDial: DataConnection | null = null
  private dialHangTimer: number | null = null
  private lastPeerReconnectAt = 0
  private dialTarget: string | null = null
  private rememberGuestAuth: { phoneId: string; key: Uint8Array } | null = null
  private listenPeer: Peer | null = null
  private listenRetry = 0
  private authTimer: number | null = null
  private authPending: {
    conn: DataConnection
    phase: RememberGatePhase
    phoneNonce: Uint8Array | null
  } | null = null
  private rememberPhones: Map<string, { key: Uint8Array; name: string }> | null = null
  private rememberHostAuth = new RememberHostAuth()

  constructor(role: Role, code: string, opts?: { rememberGuest?: SavedLaptop }) {
    this.role = role
    this.code = normalizePairCode(code)
    if (opts?.rememberGuest) {
      const g = opts.rememberGuest
      this.dialTarget = listenPeerId(g.listenId)
      this.rememberGuestAuth = { phoneId: g.phoneId, key: phoneKeyBytes(g) }
    }
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
      if (this.role === 'host') {
        this.hostFails = 0
        this.set({ status: this.conn?.open ? 'connected' : 'waiting', error: '' })
      } else if (guestShouldRedialOnPeerOpen(this.role, this.status, !!this.conn?.open)) this.dial()
    })
    peer.on('connection', (c) => {
      if (this.role !== 'host') { c.close(); return }
      if (this.conn && this.conn !== c) { try { this.conn.close() } catch {} }
      if (!c.open) this.set({ status: 'connecting' })
      this.attach(c)
    })
    peer.on('call', (call) => this.routeIncomingCall(call))
    peer.on('disconnected', () => {
      if (this.destroyed) return
      this.set({ status: this.everConnected ? 'reconnecting' : this.status })
      window.setTimeout(() => {
        if (this.role === 'host') {
          if (shouldHostReconnect({
            role: 'host',
            linkDestroyed: this.destroyed,
            samePeer: peer === this.peer,
            disconnected: peer.disconnected,
            peerDestroyed: peer.destroyed,
          })) {
            try { peer.reconnect() } catch {}
          }
          return
        }
        this.tryGuestPeerReconnect(peer)
      }, 1500)
    })
    peer.on('error', (e: any) => {
      const t = e?.type
      if (t === 'unavailable-id' && this.role === 'host') {
        this.retry++
        peer.destroy()
        if (hostUnavailableIdGiveUp(this.retry)) {
          this.set({ status: 'error', error: 'Could not claim this pairing code. Try again.' })
          return
        }
        window.setTimeout(() => this.start(), hostUnavailableIdBackoffMs(this.retry))
        return
      }
      if (t === 'peer-unavailable') {
        this.releaseInFlightDial()
        this.dropConn()
        if (guestFailFastOnPeerUnavailable(this.role, this.everConnected)) {
          this.failGuestHostNotFound()
          return
        }
        this.retry++
        const max = guestUnavailableRetries(this.everConnected)
        if (this.retry > max) {
          this.failGuestHostNotFound()
          return
        }
        this.set({ status: 'reconnecting' })
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
        if (this.role === 'guest' && this.peer && !this.conn?.open && !this.hasInFlightDial()) this.scheduleDial()
        return
      }
      console.warn('peer error', t, e)
    })
    this.timers.push(window.setInterval(() => this.tick(), 4000))
    if (this.role === 'host') void this.bootstrapRememberListen(config)
  }

  refreshRememberListen(stopListen = false) {
    if (this.authTimer) clearTimeout(this.authTimer)
    this.authTimer = null
    try { this.listenPeer?.destroy() } catch {}
    this.listenPeer = null
    if (stopListen) {
      this.rememberPhones = null
      this.listenRetry = 0
      return
    }
    void this.bootstrapRememberListen()
  }

  private async bootstrapRememberListen(config?: RTCConfiguration) {
    const store = loadHostStore()
    if (!hostHasPhones(store) || !store) return
    const rtc = config ?? (await loadRtcConfiguration())
    if (this.destroyed) return
    this.rememberPhones = new Map(
      store.phones.map((p) => [p.id, { key: phoneKeyBytes(p), name: p.name }]),
    )
    const id = listenPeerId(store.listenId)
    if (this.listenPeer && !this.listenPeer.destroyed) return
    const peer = new Peer(id, { ...SIGNAL, config: rtc })
    this.listenPeer = peer
    peer.on('connection', (c) => {
      if (this.role !== 'host' || this.destroyed) { try { c.close() } catch {}; return }
      if (!this.rememberHostAuth.canAcceptConnection(c, this.conn)) {
        try { c.close() } catch {}
        return
      }
      this.attachRememberHost(c)
    })
    peer.on('call', (call) => this.routeIncomingCall(call))
    peer.on('error', (e: any) => {
      if (e?.type !== 'unavailable-id' || this.destroyed) return
      this.listenRetry++
      peer.destroy()
      this.listenPeer = null
      if (hostUnavailableIdGiveUp(this.listenRetry)) return
      window.setTimeout(() => { if (!this.destroyed) void this.bootstrapRememberListen(rtc) }, hostUnavailableIdBackoffMs(this.listenRetry))
    })
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
    this.releaseInFlightDial()
    this.dropConn()
    try { this.conn?.open && this.conn.close() } catch {}
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
    if (this.role !== 'guest' || this.destroyed || this.status === 'error') return
    this.retry = 0
    if (this.dialWait) clearTimeout(this.dialWait)
    this.dialWait = null
    this.releaseInFlightDial()
    this.dropConn()
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

  private dropConn() {
    if (this.conn && !this.conn.open) {
      try { this.conn.close() } catch {}
    }
    this.conn = null
  }

  private releaseInFlightDial() {
    if (this.dialHangTimer) {
      clearTimeout(this.dialHangTimer)
      this.dialHangTimer = null
    }
    const c = this.inFlightDial
    if (c && !c.open) {
      try { c.close() } catch {}
    }
    this.inFlightDial = null
    this.inFlightDialUntil = 0
    if (this.pending === c) this.pending = null
  }

  private hasInFlightDial() {
    return guestDialInFlight(this.inFlightDialUntil)
  }

  private closePending() {
    if (!this.pending) return
    if (!this.pending.open) {
      try { this.pending.close() } catch {}
    }
    this.pending = null
  }

  private scheduleDial() {
    if (this.status === 'error' || this.dialWait || this.hasInFlightDial()) return
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
    }
    peer.on('open', onReopen)
  }

  private clearGuestWatchdog() {
    this.connectingSince = 0
    this.guestStallRetrying = false
  }

  private failGuestHostNotFound() {
    if (this.dialWait) clearTimeout(this.dialWait)
    this.dialWait = null
    this.clearGuestWatchdog()
    this.dialOnOpenPending = false
    this.releaseInFlightDial()
    this.dropConn()
    this.retry = 0
    this.set({ status: 'error', error: MSG_HOST_NOT_FOUND })
  }

  private dial() {
    if (this.destroyed || this.status === 'error') return
    if (this.conn?.open) return
    if (this.hasInFlightDial()) return
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
      if (this.role === 'guest' && !this.conn?.open) {
        if (!guestShouldRedialOnPeerOpen(this.role, this.status, !!this.conn?.open)) {
          this.set({ status: this.everConnected ? 'reconnecting' : 'connecting' })
        }
        if (!this.connectingSince) this.connectingSince = Date.now()
      }
      return
    }
    this.releaseInFlightDial()
    this.dropConn()
    this.set({ status: this.everConnected ? 'reconnecting' : 'connecting' })
    if (this.role === 'guest' && !this.connectingSince) this.connectingSince = Date.now()
    const target = this.dialTarget ?? peerIdForCode(this.code)
    const c = peer.connect(target, { reliable: true, serialization: 'binary' })
    const ms = dialOpenTimeoutMs(isRelayOnly())
    this.inFlightDial = c
    this.pending = c
    this.inFlightDialUntil = Date.now() + ms
    this.attach(c)
    this.dialHangTimer = window.setTimeout(() => {
      this.dialHangTimer = null
      if (!this.destroyed && this.inFlightDial === c && !c.open) {
        this.releaseInFlightDial()
        this.dropConn()
        if (this.role === 'guest' && !this.destroyed) this.scheduleDial()
      }
    }, ms)
  }

  private ownConn(c: DataConnection) {
    return c === this.conn || c === this.pending || c === this.inFlightDial || c === this.authPending?.conn
  }

  private rememberGuestLive(): boolean {
    return !this.rememberGuestAuth || (this.status === 'connected' && !!this.conn?.open)
  }

  private routeIncomingCall(call: MediaConnection) {
    if (!this.rememberGuestLive() || !shouldAcceptIncomingCall(this.conn, call.peer)) {
      try { call.close() } catch {}
      return
    }
    this.callHandlers.forEach((h) => h(call))
  }

  private clearAuthPending() {
    if (this.authTimer) clearTimeout(this.authTimer)
    this.authTimer = null
    this.authPending = null
    this.rememberHostAuth.clear()
  }

  private attach(c: DataConnection) {
    if (this.rememberGuestAuth) {
      this.attachRememberGuest(c)
      return
    }
    if (this.role === 'guest' && this.conn && this.conn !== c && this.conn.open) {
      try { c.close() } catch {}
      return
    }
    if (this.role === 'host' || c.open) this.conn = c
    const onOpen = () => {
      if (c !== this.inFlightDial && c !== this.pending && c !== this.conn) return
      this.lastSeen = Date.now()
      this.everConnected = true
      this.retry = 0
      this.hostFails = 0
      if (this.dialHangTimer) { clearTimeout(this.dialHangTimer); this.dialHangTimer = null }
      this.inFlightDial = null
      this.inFlightDialUntil = 0
      this.pending = null
      this.conn = c
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
      if (c !== this.conn) return
      this.dispatchPayload(m, c)
    })
    c.on('close', () => this.lost(c))
    c.on('error', () => this.lost(c))
  }

  private dispatchPayload(m: any, c: DataConnection) {
    if (c !== this.conn) return
    if (!this.rememberGuestLive()) return
    this.lastSeen = Date.now()
    if (!m || typeof m !== 'object') return
    if (m.t === 'ping') return
    if (m.t === 'hello') {
      this.set({ remoteName: m.name })
      if (this.role === 'guest' && this.code) rememberLastLaptop(m.name, this.code)
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
  }

  private armAuthTimeout(c: DataConnection) {
    if (c !== this.authPending?.conn) return
    if (this.authTimer) clearTimeout(this.authTimer)
    this.authTimer = window.setTimeout(() => this.failRememberAuth(c), REMEMBER_PROOF_TIMEOUT_MS)
  }

  private failRememberAuth(c: DataConnection) {
    if (this.role === 'host') {
      if (c !== this.rememberHostAuth.authPending?.conn) return
      this.rememberHostAuth.clear()
      try { c.close() } catch {}
      return
    }
    if (c !== this.authPending?.conn) return
    this.clearAuthPending()
    try { c.close() } catch {}
    this.set({ status: 'error', error: MSG_REMEMBER_UNREACHABLE })
  }

  private promoteConnected(c: DataConnection, remoteHint?: string) {
    const fromAuth = this.authPending?.conn === c
    if (!fromAuth && c !== this.inFlightDial && c !== this.pending && c !== this.conn) return
    this.lastSeen = Date.now()
    this.everConnected = true
    this.retry = 0
    this.hostFails = 0
    if (this.dialHangTimer) { clearTimeout(this.dialHangTimer); this.dialHangTimer = null }
    this.inFlightDial = null
    this.inFlightDialUntil = 0
    this.pending = null
    this.clearAuthPending()
    this.conn = c
    if (this.hostGrace) { clearTimeout(this.hostGrace); this.hostGrace = null }
    try { c.send({ t: 'hello', name: deviceName() }) } catch {}
    if (remoteHint) this.set({ remoteName: remoteHint })
    this.set({ status: 'connected', error: '' })
    if (this.role === 'guest') {
      if (this.code) rememberGuestPairedCode(this.code)
      this.clearGuestWatchdog()
    }
  }

  private attachRememberGuest(c: DataConnection) {
    if (this.conn?.open) {
      try { c.close() } catch {}
      return
    }
    if (this.authPending) {
      try { c.close() } catch {}
      return
    }
    if (this.conn && !this.conn.open) this.dropConn()
    this.authPending = { conn: c, phase: 'await-hello', phoneNonce: null }
    const greet = () => {
      if (c !== this.authPending?.conn || !this.rememberGuestAuth) return
      const phoneNonce = randomBytes(32)
      this.authPending = { conn: c, phase: 'await-proof', phoneNonce }
      try {
        c.send({
          t: 'remember:hello',
          phoneId: this.rememberGuestAuth.phoneId,
          phoneNonce: bytesToB64(phoneNonce),
        })
      } catch {}
      this.armAuthTimeout(c)
      this.set({ status: this.everConnected ? 'reconnecting' : 'connecting' })
    }
    if (c.open) greet(); else c.on('open', greet)
    c.on('data', async (m: any) => {
      if (c === this.authPending?.conn) {
        if (!m || typeof m !== 'object') return
        if (m.t === 'remember:challenge' && typeof m.nonce === 'string' && this.rememberGuestAuth && this.authPending.phoneNonce) {
          const hostNonce = bytesFromB64(m.nonce)
          const proof = await signPhoneProof(this.rememberGuestAuth.key, hostNonce)
          try { c.send({ t: 'remember:proof', proof: bytesToB64(proof) }) } catch {}
          return
        }
        if (m.t === 'remember:ok' && this.rememberGuestAuth && this.authPending.phoneNonce) {
          const ok = await guestAcceptsRememberOk(m, this.rememberGuestAuth.key, this.authPending.phoneNonce)
          if (!ok) {
            this.failRememberAuth(c)
            return
          }
          this.promoteConnected(c)
          return
        }
        return
      }
      if (c === this.conn) this.dispatchPayload(m, c)
    })
    c.on('close', () => this.lost(c))
    c.on('error', () => this.lost(c))
  }

  private hostAuthCallbacks(): import('../remember/hostAuth').HostAuthCallbacks {
    return {
      onPromote: (conn, remoteName) => this.promoteConnected(conn as DataConnection, remoteName),
      onFail: (conn) => this.failRememberAuth(conn as DataConnection),
      onDispatch: (conn, m) => this.dispatchPayload(m as any, conn as DataConnection),
      onTimeout: (conn) => this.failRememberAuth(conn as DataConnection),
    }
  }

  private attachRememberHost(c: DataConnection) {
    if (this.conn && !this.conn.open) this.dropConn()
    const cb = this.hostAuthCallbacks()
    this.rememberHostAuth.beginAuth(c, this.conn, cb)
    c.on('data', (m: any) => {
      void this.rememberHostAuth.handleData(c, m, this.rememberPhones, this.conn, cb)
    })
    c.on('close', () => this.lost(c))
    c.on('error', () => this.lost(c))
  }

  private lost(c: DataConnection) {
    if (c === this.rememberHostAuth.authPending?.conn) {
      this.rememberHostAuth.clear()
      return
    }
    if (c === this.authPending?.conn) {
      this.clearAuthPending()
      return
    }
    if (!this.ownConn(c) || this.destroyed) return
    if (this.status === 'closed') return
    if (c === this.inFlightDial || (c === this.pending && !c.open)) {
      this.releaseInFlightDial()
      this.dropConn()
    } else if (this.conn === c) {
      this.dropConn()
    }
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
    else if (!this.hasInFlightDial()) {
      this.set({ status: 'reconnecting' })
      this.scheduleDial()
    }
  }

  private tickGuestWatchdog() {
    if (this.role !== 'guest' || this.destroyed || this.status === 'error') return
    if (this.status !== 'connecting' || this.conn?.open) return
    if (!this.connectingSince) return
    const elapsed = Date.now() - this.connectingSince
    if (elapsed < GUEST_CONNECTING_WATCHDOG_MS) return
    if (this.hasInFlightDial()) {
      if (!this.guestStallRetrying) {
        this.guestStallRetrying = true
        this.listeners.forEach((l) => l())
      }
      return
    }
    this.connectingSince = Date.now()
    this.guestStallRetrying = true
    this.listeners.forEach((l) => l())
    this.redialGuestNow()
  }

  private guestPeerReconnectSnapshot(peer: Peer) {
    return {
      role: this.role,
      disconnected: peer.disconnected,
      peerDestroyed: peer.destroyed,
      linkDestroyed: this.destroyed,
      lastPeerReconnectAt: this.lastPeerReconnectAt,
    }
  }

  private tryGuestPeerReconnect(peer: Peer) {
    if (this.role !== 'guest' || !shouldCallPeerReconnect(this.guestPeerReconnectSnapshot(peer))) return
    this.lastPeerReconnectAt = Date.now()
    try { peer.reconnect() } catch {}
  }

  private tick() {
    this.tickGuestWatchdog()
    const peer = this.peer
    if (this.role === 'guest' && peer && peer.disconnected && !peer.destroyed && !this.destroyed) {
      this.tryGuestPeerReconnect(peer)
    }
    if (this.role === 'host' && peer && shouldHostReconnect({
      role: 'host',
      linkDestroyed: this.destroyed,
      samePeer: true,
      disconnected: peer.disconnected,
      peerDestroyed: peer.destroyed,
    })) {
      try { peer.reconnect() } catch {}
    }
    const c = this.conn
    if (c?.open) {
      try { c.send({ t: 'ping' }) } catch {}
      if (Date.now() - this.lastSeen > 15000) { try { c.close() } catch {}; this.lost(c) }
    } else if (this.role === 'guest' && (this.status === 'reconnecting' || this.status === 'connecting') && this.peer && !this.peer.disconnected) {
      if (!this.dialWait && !this.hasInFlightDial()) this.scheduleDial()
    }
  }

  get remoteId() { return this.conn?.peer }
  get connected() { return this.status === 'connected' && !!this.conn?.open }

  send(m: any) {
    if (!this.rememberGuestLive()) return
    const pending = this.authPending || this.rememberHostAuth.authPending
    if (!shouldLinkSend(this.conn, pending)) return
    try { this.conn!.send(m) } catch {}
  }

  call(stream: MediaStream, kind: string) {
    if (!this.rememberGuestLive()) throw new Error('Not connected')
    const pending = this.authPending || this.rememberHostAuth.authPending
    if (!this.peer || !this.remoteId || pending) throw new Error('Not connected')
    return this.peer.call(this.remoteId, stream, { metadata: { kind } })
  }

  disconnect() {
    if (linkTeardownSendsBye('disconnect')) {
      try { this.conn?.send({ t: 'bye' }) } catch {}
    }
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
    this.releaseInFlightDial()
    this.closePending()
    this.clearAuthPending()
    try { this.listenPeer?.destroy() } catch {}
    this.listenPeer = null
    this.peer?.destroy()
  }
}
