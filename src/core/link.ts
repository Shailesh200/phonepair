import Peer, { DataConnection, MediaConnection } from 'peerjs'

import type { Role } from './bus'
import { newPairCode, normalizePairCode, peerIdForCode } from '../features/pairing/code'
import {
  guestFailFastOnPeerUnavailable,
  MSG_HOST_NOT_FOUND,
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
import {
  ensureHostReclaimStarted,
  hostUnavailableIdBackoffForClaim,
  hostUnavailableIdShouldGiveUp,
  shouldUseHostIdReclaimWindow,
} from '../features/pairing/hostIdReclaim'
import { guestUnavailableRetries, redialDelayMs } from '../features/pairing/reconnect'
import { linkTeardownSendsBye } from '../features/pairing/teardown'
import { shouldCallPeerReconnect, shouldHostReconnect } from '../features/pairing/peerReconnect'
import {
  ForceSignalRunner,
  forceSignalReconnect,
  shouldForceSignalOnVisibility,
} from '../features/pairing/forceSignalReconnect'
import {
  hostKeepsConnectedStatusOnSignalDrop,
  shouldHostReconnectHalfOpen,
  shouldHostReconnectOnOnline,
} from '../features/pairing/hostSignalReconnect'
import {
  canGuestIceRedial,
  iceDisconnectedRedialDelayMs,
  isDataConnIceOfferer,
  iceTransportRecovered,
  shouldActOnIceNetworkChange,
  shouldArmIceGraceTimer,
  shouldRedialAfterDisconnectedGrace,
  shouldRedialImmediatelyOnIceFailed,
} from '../features/pairing/iceRecovery'
import { candidatePairUsesRelay } from '../features/pairing/relayStats'
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
  private inFlightDialUntil = 0
  private inFlightDial: DataConnection | null = null
  private dialHangTimer: number | null = null
  private lastPeerReconnectAt = 0
  private documentHiddenAt: number | null = null
  private networkWatchersCleanup: (() => void) | null = null
  private iceDisconnectedAt: number | null = null
  private iceRedialTimer: number | null = null
  private hostIdReclaimSince: number | null = null
  private hostUnavailableRetry = 0
  private iceWatchCleanup: (() => void) | null = null
  private hostSignalRunner: ForceSignalRunner | null = null
  connViaRelay: boolean | null = null

  constructor(role: Role, code: string) {
    this.role = role
    this.code = normalizePairCode(code)
  }
  subscribe(l: Listener) { this.listeners.add(l); return () => { this.listeners.delete(l) } }
  onMessage(h: MsgHandler) { this.msgHandlers.add(h); return () => { this.msgHandlers.delete(h) } }
  onCall(h: CallHandler) { this.callHandlers.add(h); return () => { this.callHandlers.delete(h) } }
  private set(s: Partial<Link>) { Object.assign(this, s); this.listeners.forEach((l) => l()) }

  private clearTickTimers() {
    for (const id of this.timers) clearInterval(id)
    this.timers = []
  }

  private bindNetworkWatchers() {
    if (this.networkWatchersCleanup) return
    const onOnline = () => {
      if (shouldHostReconnectOnOnline(this.role, this.destroyed)) {
        const peer = this.peer
        if (peer && !peer.destroyed) this.ensureHostSignalRunner().hookOnline(peer, false)
      }
      this.onIceNetworkChange()
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        this.documentHiddenAt = Date.now()
        return
      }
      if (this.documentHiddenAt != null) {
        const hiddenMs = Date.now() - this.documentHiddenAt
        this.documentHiddenAt = null
        if (this.role === 'host' && shouldForceSignalOnVisibility(hiddenMs, this.hostCodeSignalUnverified())) {
          const peer = this.peer
          if (peer && !peer.destroyed) this.ensureHostSignalRunner().hook(peer, false)
        }
      }
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVis)
    const nav = navigator as Navigator & { connection?: { addEventListener: (e: string, h: () => void) => void; removeEventListener: (e: string, h: () => void) => void } }
    const conn = nav.connection
    const onNetChange = () => this.onIceNetworkChange()
    conn?.addEventListener?.('change', onNetChange)
    this.networkWatchersCleanup = () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVis)
      conn?.removeEventListener?.('change', onNetChange)
      this.networkWatchersCleanup = null
    }
  }

  private ensureHostSignalRunner(): ForceSignalRunner {
    if (!this.hostSignalRunner) {
      this.hostSignalRunner = new ForceSignalRunner({
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => { if (id != null) window.clearTimeout(id) },
        now: () => Date.now(),
      })
    }
    return this.hostSignalRunner
  }

  private hostCodeSignalUnverified(): boolean {
    return (
      this.role === 'host'
      && this.everConnected
      && (this.status === 'reconnecting' || this.status === 'waiting')
      && !this.conn?.open
    )
  }

  private hostCodeSignalForceActive(peer: Peer): boolean {
    if (this.role !== 'host' || this.destroyed || peer.destroyed) return false
    if (this.hostCodeSignalUnverified()) return true
    if (this.status === 'reconnecting' || this.status === 'waiting') return true
    return shouldHostReconnectHalfOpen(this.role, this.destroyed, peer.open, !!this.conn?.open)
  }

  private tickHostCodeSignalForce(peer: Peer) {
    const unverified = this.hostCodeSignalUnverified()
    const peerLooksHealthy = peer.open && !peer.disconnected && !unverified
    this.ensureHostSignalRunner().tick(
      peer,
      this.hostCodeSignalForceActive(peer),
      false,
      peerLooksHealthy,
      unverified,
    )
  }

  private forceHostPeerSignalReconnect() {
    const peer = this.peer
    if (!peer || peer.destroyed || this.destroyed) return
    this.ensureHostSignalRunner().hook(peer, false)
  }

  private clearIceGraceTimer() {
    if (this.iceRedialTimer) {
      clearTimeout(this.iceRedialTimer)
      this.iceRedialTimer = null
    }
  }

  private clearIceRecovery() {
    this.clearIceGraceTimer()
    this.iceWatchCleanup?.()
    this.iceWatchCleanup = null
    this.iceDisconnectedAt = null
  }

  private peerConnectionOf(c: DataConnection): RTCPeerConnection | null {
    const pc = (c as DataConnection & { peerConnection?: RTCPeerConnection }).peerConnection
    return pc ?? null
  }

  async refreshConnRelay() {
    const pc = this.conn ? this.peerConnectionOf(this.conn) : null
    if (!pc) {
      this.connViaRelay = null
      this.listeners.forEach((l) => l())
      return
    }
    try {
      this.connViaRelay = candidatePairUsesRelay(await pc.getStats())
    } catch {
      this.connViaRelay = null
    }
    this.listeners.forEach((l) => l())
  }

  private onIceNetworkChange() {
    if (!isDataConnIceOfferer(this.role) || this.destroyed) return
    const pc = this.conn ? this.peerConnectionOf(this.conn) : null
    if (!pc) return
    const state = pc.iceConnectionState
    if (!shouldActOnIceNetworkChange(state)) return
    if (state === 'disconnected' && this.iceDisconnectedAt == null) this.iceDisconnectedAt = Date.now()
    if (shouldRedialImmediatelyOnIceFailed(state)) {
      this.clearIceGraceTimer()
      this.scheduleGuestIceRedial()
      return
    }
    this.armIceGraceRedial(pc)
  }

  private scheduleGuestIceRedial() {
    if (!canGuestIceRedial(this.hasInFlightDial(), !!this.dialWait, this.destroyed)) return
    if (this.conn?.open) {
      try { this.conn.close() } catch {}
      return
    }
    this.set({ status: this.everConnected ? 'reconnecting' : 'connecting', error: '' })
    this.scheduleDial()
  }

  private armIceGraceRedial(pc: RTCPeerConnection) {
    if (!isDataConnIceOfferer(this.role) || this.destroyed) return
    if (!shouldArmIceGraceTimer(!!this.iceRedialTimer, this.iceDisconnectedAt)) return
    const since = this.iceDisconnectedAt!
    const delay = iceDisconnectedRedialDelayMs(since, Date.now())
    this.iceRedialTimer = window.setTimeout(() => {
      this.iceRedialTimer = null
      if (this.destroyed) return
      const pcNow = this.conn ? this.peerConnectionOf(this.conn) : null
      const state = pcNow?.iceConnectionState ?? 'disconnected'
      if (shouldRedialAfterDisconnectedGrace(since, state, Date.now())) {
        this.scheduleGuestIceRedial()
      }
    }, delay)
  }

  private handleGuestIce(pc: RTCPeerConnection) {
    const now = Date.now()
    const state = pc.iceConnectionState
    if (iceTransportRecovered(state)) {
      this.clearIceGraceTimer()
      this.iceDisconnectedAt = null
      return
    }
    if (state === 'disconnected' && this.iceDisconnectedAt == null) this.iceDisconnectedAt = now
    if (!isDataConnIceOfferer(this.role)) return
    if (shouldRedialImmediatelyOnIceFailed(state)) {
      this.clearIceGraceTimer()
      this.scheduleGuestIceRedial()
      return
    }
    this.armIceGraceRedial(pc)
  }

  private wireIceRecovery(c: DataConnection) {
    this.clearIceRecovery()
    const pc = this.peerConnectionOf(c)
    if (!pc) return
    const onIce = () => this.handleGuestIce(pc)
    pc.addEventListener('iceconnectionstatechange', onIce)
    const onPeerIce = () => onIce()
    c.on('iceStateChanged', onPeerIce)
    this.iceWatchCleanup = () => {
      pc.removeEventListener('iceconnectionstatechange', onIce)
      c.off('iceStateChanged', onPeerIce)
    }
    this.handleGuestIce(pc)
  }

  async start() {
    this.clearTickTimers()
    const config = await loadRtcConfiguration()
    if (this.destroyed) return
    this.bindNetworkWatchers()
    const id = this.role === 'host' ? peerIdForCode(this.code) : undefined
    const peer = id ? new Peer(id, { ...SIGNAL, config }) : new Peer({ ...SIGNAL, config })
    this.peer = peer
    peer.on('open', () => {
      if (this.role === 'host' && this.conn?.open) {
        this.ensureHostSignalRunner().onPhoneConnected()
      }
      this.hostIdReclaimSince = null
      this.hostUnavailableRetry = 0
      this.retry = 0
      if (this.role === 'host') {
        this.hostFails = 0
        const st = this.conn?.open ? 'connected' : 'waiting'
        this.set({ status: st, error: '' })
      } else if (guestShouldRedialOnPeerOpen(this.role, this.status, !!this.conn?.open)) this.dial()
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
      if (this.role === 'host' && this.everConnected) {
        const now = Date.now()
        const started = ensureHostReclaimStarted(true, this.hostIdReclaimSince, now)
        if (started !== this.hostIdReclaimSince) {
          this.hostIdReclaimSince = started
          this.hostUnavailableRetry = 0
        }
        this.ensureHostSignalRunner().onSignalingDrop()
      }
      const keepHostUi =
        this.role === 'host' && hostKeepsConnectedStatusOnSignalDrop(!!this.conn?.open)
      if (!keepHostUi) {
        this.set({ status: this.everConnected ? 'reconnecting' : this.status })
      }
      window.setTimeout(() => {
        if (this.role === 'host') {
          if (peer === this.peer && !this.destroyed) this.forceHostPeerSignalReconnect()
          return
        }
        this.tryGuestPeerReconnect(peer)
      }, 1500)
    })
    peer.on('error', (e: any) => {
      const t = e?.type
      if (t === 'unavailable-id' && this.role === 'host') {
        const now = Date.now()
        this.hostIdReclaimSince = ensureHostReclaimStarted(
          this.everConnected,
          this.hostIdReclaimSince,
          now,
        )
        const reclaim = shouldUseHostIdReclaimWindow(this.everConnected, this.hostIdReclaimSince)
        const attempt = reclaim ? ++this.hostUnavailableRetry : ++this.retry
        if (hostUnavailableIdShouldGiveUp(attempt, this.hostIdReclaimSince, now, this.everConnected)) {
          this.hostIdReclaimSince = null
          this.ensureHostSignalRunner().onOpen()
          const msg = reclaim
            ? 'Could not reclaim this pairing code. Try again.'
            : 'Could not claim this pairing code. Try again.'
          this.set({ status: 'error', error: msg })
          return
        }
        const delay = hostUnavailableIdBackoffForClaim(attempt, this.hostIdReclaimSince, this.everConnected)
        const keepConn = reclaim && !!this.conn?.open
        if (!keepConn) {
          try { peer.destroy() } catch {}
          this.peer = null
        }
        window.setTimeout(() => {
          if (this.destroyed) return
          if (keepConn && peer === this.peer && !peer.destroyed) {
            forceSignalReconnect(peer)
            return
          }
          if (!this.peer) void this.start()
        }, delay)
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
    this.clearIceRecovery()
    this.connViaRelay = null
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
    const c = peer.connect(peerIdForCode(this.code), { reliable: true, serialization: 'binary' })
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
    return c === this.conn || c === this.pending || c === this.inFlightDial
  }

  private attach(c: DataConnection) {
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
      if (this.role === 'host') this.ensureHostSignalRunner().onPhoneConnected()
      c.send({ t: 'hello', name: deviceName() })
      this.set({ status: 'connected', error: '' })
      this.wireIceRecovery(c)
      void this.refreshConnRelay()
      if (this.role === 'guest') {
        rememberGuestPairedCode(this.code)
        this.clearGuestWatchdog()
      }
    }
    if (c.open) onOpen(); else c.on('open', onOpen)
    c.on('data', (m: any) => {
      if (c !== this.conn) return
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
    if (!this.ownConn(c) || this.destroyed) return
    if (this.status === 'closed') return
    if (c === this.inFlightDial || (c === this.pending && !c.open)) {
      this.releaseInFlightDial()
      this.dropConn()
    } else if (this.conn === c) {
      this.dropConn()
    }
    if (this.role === 'host') {
      const peer = this.peer
      if (this.everConnected && !this.conn?.open) {
        this.ensureHostSignalRunner().onSignalingDrop()
      }
      if (
        peer
        && shouldHostReconnectHalfOpen(this.role, this.destroyed, !!peer.open, !!this.conn?.open)
      ) {
        this.forceHostPeerSignalReconnect()
      }
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
    if (this.role === 'host' && peer && !peer.destroyed) {
      this.tickHostCodeSignalForce(peer)
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

  send(m: any) { if (this.conn?.open) this.conn.send(m) }

  call(stream: MediaStream, kind: string) {
    if (!this.peer || !this.remoteId) throw new Error('Not connected')
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
    this.clearTickTimers()
    this.hostSignalRunner?.stop()
    this.hostSignalRunner = null
    this.networkWatchersCleanup?.()
    this.clearIceRecovery()
    if (this.dialWait) clearTimeout(this.dialWait)
    this.clearGuestWatchdog()
    this.dialOnOpenPending = false
    this.releaseInFlightDial()
    this.closePending()
    this.peer?.destroy()
  }
}
