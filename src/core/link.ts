import Peer, { DataConnection, MediaConnection } from 'peerjs'

import type { Role } from './bus'
import { newPairCode, normalizePairCode, peerIdForCode } from '../features/pairing/code'
import {
  guestFailFastOnPeerUnavailable,
  MSG_HOST_NOT_FOUND,
  MSG_REMEMBER_DENIED,
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
import { hostUnavailableIdBackoffMs } from '../features/pairing/hostClaim'
import {
  ensureHostReclaimStarted,
  hostUnavailableIdBackoffForClaim,
  hostUnavailableIdShouldGiveUp,
  shouldUseHostIdReclaimWindow,
} from '../features/pairing/hostIdReclaim'
import {
  guestRedialPlanAfterSignalRecovery,
  guestUnavailableShouldGiveUp,
  redialDelayMs,
} from '../features/pairing/reconnect'
import { linkTeardownSendsBye } from '../features/pairing/teardown'
import {
  ForceSignalRunner,
  forceSignalReconnect,
  shouldForceSignalOnVisibility,
} from '../features/pairing/forceSignalReconnect'
import { notifyHostPhoneConnected } from '../features/pairing/hostDualForceRunner'
import { hostListenStaggerUntil, shouldDeferListenForce } from '../features/pairing/hostSignalStagger'
import { HOST_FORCE_HOOK_MIN_MS, mayHostForceHook } from '../features/pairing/hostForceHookThrottle'
import { peerAsForceSignal, trackCodePeerSocketOpen, trackListenPeerSocketOpen } from '../features/pairing/peerForceAdapter'
import { takePeerForceDisconnect } from '../features/pairing/forceSignalSelf'
import {
  ppDebugIncSignalDropExternal,
  ppDebugIncSignalDropIgnoredSelf,
} from '../features/pairing/ppDebugForceDrops'
import { FORCE_LISTEN_SETTLE_MS, listenForceRecycleDeferred } from '../remember/listenForceSettle'
import {
  ppDebugIncForceRun,
  ppDebugIncGuestForce,
  ppDebugIncGuestSocketOpen,
  ppDebugRecordGuestRedial,
  ppDebugIncListenBootstrap,
  ppDebugIncListenReject,
  ppDebugIncListenSocketClosedConnecting,
} from '../features/pairing/ppDebug'
import {
  ppDebugIncListenServerOpen,
  ppDebugIncListenSocketUnavailableId,
  ppDebugIncListenWsCreated,
  ppDebugMarkListenRecoveryDrop,
  ppDebugRecordListenFirstServerOpenAfterDrop,
} from '../features/pairing/ppDebugListenSocket'
import {
  ppDebugIncListenAuthCompleted,
  ppDebugIncListenAuthStarted,
  ppDebugIncListenConnOpened,
  ppDebugIncListenIncomingConn,
  ppDebugSetListenSocketReadyStateAgeMs,
} from '../features/pairing/ppDebugListenHost'
import {
  ppDebugRememberAuthSent,
  ppDebugRememberDial,
  ppDebugRememberDialError,
  ppDebugRememberDialOpened,
} from '../features/pairing/ppDebugRemember'
import { shouldCallPeerReconnect, shouldHostReconnect } from '../features/pairing/peerReconnect'
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
  shouldAbandonOpenDataConn,
  shouldArmIceGraceTimer,
  shouldRedialAfterDisconnectedGrace,
  shouldRedialImmediatelyOnIceFailed,
} from '../features/pairing/iceRecovery'
import {
  ppDebugIncAbandonOnSignalDrop,
  ppDebugRecordDataConnected,
  ppDebugRecordIceTransport,
} from '../features/pairing/ppDebugIce'
import { candidatePairUsesRelay } from '../features/pairing/relayStats'
import { rememberLastLaptop } from '../features/pairing/session'
import { guestAcceptsRememberOk } from '../remember/guestAuth'
import {
  guestRememberIncomingAuthAction,
  guestRememberKeepLiveOnAuthFail,
  guestRememberSwapOnPromote,
} from '../remember/guestRememberConn'
import { guestRememberDialShouldClearOpenConn } from '../remember/guestDialStaleConn'
import { listenForceTickAllowed } from '../remember/hostRememberListenPriority'
import { peerForOutboundCall } from '../remember/callPeer'
import { signPhoneProof } from '../remember/proof'
import type { HostAuthFailReason } from '../remember/hostAuth'
import { canPromoteDataConn } from '../remember/promoteEligibility'
import { shouldTickBootstrapListen } from '../remember/listenGiveUp'
import { hostRememberListenOtherTab } from '../remember/rememberOtherTab'
import {
  canOpenRememberListenSocket,
} from '../remember/rememberListenClaim'
import {
  ensureListenReclaimStarted,
  shouldRearmListenPeer,
} from '../remember/listenIdReclaim'
import {
  planListenRecoveryOnServerOpen,
  listenRecoveryReclaimUntilFromDrop,
} from '../remember/listenRecoveryModePolicy'
import {
  listenReclaimRecycleSkipsOpenSocket,
  shouldClearStaleRememberMainConnForRecovery,
  shouldListenReclaimRecyclePeer,
} from '../remember/rememberRecoveryConn'
import {
  shouldDeferListenBootstrapWhileOffline,
  shouldHostArmListenIdRecovery,
  shouldHostRememberSignalWork,
} from '../remember/rememberListenRecoveryGate'
import { shouldDeferListenForceRecycle } from '../remember/listenForceRecycleDefer'
import {
  LISTEN_RECOVERY_ID_BACKOFF_MS,
  listenBackoffForClaim,
  listenClaimShouldGiveUp,
} from '../remember/listenIdRecovery'
import { guestForgetMatchesSavedLaptop } from '../remember/guestForgetMatch'
import { REMEMBER_PROOF_TIMEOUT_MS, type RememberGatePhase } from '../remember/gate'
import { RememberHostAuth } from '../remember/hostAuth'
import { connBlockedByRememberAuth, shouldAcceptIncomingCall, shouldLinkSend } from '../remember/hostAuthSend'
import { hostAcceptsPhoneForget } from '../remember/hostForgetInbound'
import { shouldFailRememberGuestHome } from '../remember/guestHomeWatchdog'
import { rememberGuestDeadlineArm, REMEMBER_GUEST_HOME_MS } from '../remember/rememberGuestDeadline'
import { bytesFromB64, bytesToB64, listenPeerId, randomBytes } from '../remember/ids'
import {
  forgetGuestLaptopRecord,
  forgetHostPhoneRecord,
  hostHasPhones,
  loadGuestStore,
  loadHostStore,
  phoneKeyBytes,
  saveGuestStore,
  saveHostStore,
} from '../remember/storage'
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
  private sessionPaired = false
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
  private rememberGuestAuth: { phoneId: string; key: Uint8Array; listenId: string } | null = null
  private rememberGuestFailCount = 0
  private rememberGuestDeadlineMs = 0
  private rememberGuestEverAuthed = false
  private listenPeer: Peer | null = null
  private connPeer: Peer | null = null
  private listenRetry = 0
  private listenGaveUp = false
  private listenBootstrapInFlight = false
  private listenBackoffUntil = 0
  private listenSocketsOpened = 0
  private listenUnavailableFailures = 0
  private listenUnavailableFailureTimes: number[] = []
  private listenSocketOpenTimes: number[] = []
  private listenOwnedBefore = false
  private listenPeerEverOpen = false
  private hostListenStaggerUntil: number | null = null
  private lastCodeForceHookAt = 0
  private lastListenForceHookAt = 0
  private listenForceSettleUntil: number | null = null
  private listenRecoveryMode = false
  private listenRecoveryDropAt: number | null = null
  private listenRecoveryReclaimUntil: number | null = null
  private listenRecoveryReclaimTimer: number | null = null
  private listenRecoveryModeClearTimer: number | null = null
  private listenReclaimStartedAt: number | null = null
  private visibilityListener: (() => void) | null = null
  private networkListener: (() => void) | null = null
  private listenDocumentHiddenAt: number | null = null
  private listenForceRunner: ForceSignalRunner | null = null
  private documentHiddenAt: number | null = null
  private networkWatchersCleanup: (() => void) | null = null
  private iceDisconnectedAt: number | null = null
  private iceRedialTimer: number | null = null
  private guestUnavailableSince: number | null = null
  private hostIdReclaimSince: number | null = null
  private hostUnavailableRetry = 0
  private iceWatchCleanup: (() => void) | null = null
  private hostSignalRunner: ForceSignalRunner | null = null
  connViaRelay: boolean | null = null
  private authenticatedRememberPhoneId: string | null = null
  private authTimer: number | null = null
  private authPending: {
    conn: DataConnection
    phase: RememberGatePhase
    phoneNonce: Uint8Array | null
    hostNonce: Uint8Array | null
  } | null = null
  private rememberPhones: Map<string, { key: Uint8Array; name: string }> | null = null
  private rememberHostAuth = new RememberHostAuth()

  constructor(role: Role, code: string, opts?: { rememberGuest?: SavedLaptop }) {
    this.role = role
    this.code = normalizePairCode(code)
    if (opts?.rememberGuest) {
      const g = opts.rememberGuest
      this.dialTarget = listenPeerId(g.listenId)
      this.rememberGuestAuth = { phoneId: g.phoneId, key: phoneKeyBytes(g), listenId: g.listenId }
      this.rememberGuestDeadlineMs = rememberGuestDeadlineArm(
        0,
        Date.now(),
        REMEMBER_GUEST_HOME_MS,
      )
    }
  }

  isRememberConnOnListenPeer(): boolean {
    return !!(this.conn?.open && this.listenPeer && this.connPeer === this.listenPeer)
  }

  private hostRememberListenRecoveryArmed(): boolean {
    return shouldHostArmListenIdRecovery({
      hasRememberPhones: this.hostHasRememberPhones(),
      listenOwnedBefore: this.listenOwnedBefore,
      listenGaveUp: this.listenGaveUp,
    })
  }

  private markListenGaveUp() {
    if (this.listenGaveUp) return
    this.listenGaveUp = true
    this.clearListenRecoveryState()
    this.clearListenRecoveryReclaimTimer()
    const lp = this.listenPeer
    if (lp && !lp.destroyed) {
      this.listenForceRunner?.stop()
      try { lp.destroy() } catch {}
      this.listenPeer = null
    }
    this.listenForceRunner = null
    this.ensureHostSignalRunner().clearTimers()
    this.listeners.forEach((l) => l())
  }

  clearRememberListenGiveUp() {
    const hadGaveUp = this.listenGaveUp
    this.listenGaveUp = false
    this.listenRetry = 0
    this.listenBackoffUntil = 0
    this.listenSocketsOpened = 0
    this.listenUnavailableFailures = 0
    this.listenUnavailableFailureTimes = []
    this.listenSocketOpenTimes = []
    if (hadGaveUp) this.listeners.forEach((l) => l())
  }

  get guestSessionPaired() { return this.sessionPaired }
  get rememberListenOtherTab() {
    return this.role === 'host' && hostRememberListenOtherTab(this.listenGaveUp, loadHostStore())
  }

  private listenSignalUnverified(): boolean {
    return !!this.listenForceRunner?.isUnverifiedAfterDrop()
  }

  private bindHostListenRearmWatchers() {
    if (this.role !== 'host') return
    if (!this.visibilityListener) {
      const onVis = () => {
        if (this.listenGaveUp) return
        if (document.visibilityState === 'hidden') {
          this.listenDocumentHiddenAt = Date.now()
          return
        }
        if (this.listenDocumentHiddenAt != null) {
          const hiddenMs = Date.now() - this.listenDocumentHiddenAt
          this.listenDocumentHiddenAt = null
          if (shouldForceSignalOnVisibility(hiddenMs, this.listenSignalUnverified())) {
            const lp = this.listenPeer
            if (lp && !lp.destroyed && this.listenPeerEverOpen) {
              if (
                !shouldDeferListenForce(
                  !!this.peer?.open,
                  this.hostListenStaggerUntil,
                  Date.now(),
                  this.hostHasRememberPhones(),
                )
              ) {
                this.ensureListenForceRunner().hook(peerAsForceSignal(lp, 'listen'), false)
              }
            }
          }
        }
      }
      document.addEventListener('visibilitychange', onVis)
      this.visibilityListener = () => document.removeEventListener('visibilitychange', onVis)
    }
    if (!this.networkListener) {
      const onOnline = () => {
        if (this.listenGaveUp) return
        const lp = this.listenPeer
        if ((!lp || lp.destroyed) && this.hostHasRememberPhones()) {
          if (Date.now() >= this.listenBackoffUntil) void this.bootstrapRememberListen()
        }
        if (!lp || lp.destroyed || !this.listenPeerEverOpen) return
        const run = () => {
          if (lp !== this.listenPeer || lp.destroyed) return
          if (!this.hostRememberListenRecoveryArmed()) return
          if (this.listenRecoveryActive()) {
            this.scheduleListenRecoveryReclaim(0)
            return
          }
          this.ensureListenForceRunner().hookOnline(peerAsForceSignal(lp, 'listen'), false)
        }
        const deferMs = shouldDeferListenForce(
          !!this.peer?.open,
          this.hostListenStaggerUntil,
          Date.now(),
          this.hostHasRememberPhones(),
        )
          ? Math.max(0, (this.hostListenStaggerUntil ?? 0) - Date.now())
          : 0
        if (deferMs > 0) window.setTimeout(run, deferMs)
        else run()
      }
      window.addEventListener('online', onOnline)
      this.networkListener = () => window.removeEventListener('online', onOnline)
    }
  }

  private ensureListenForceRunner(): ForceSignalRunner {
    if (!this.listenForceRunner) {
      this.listenForceRunner = new ForceSignalRunner(
        {
          setTimeout: (fn, ms) => window.setTimeout(fn, ms),
          clearTimeout: (id) => { if (id != null) window.clearTimeout(id) },
          now: () => Date.now(),
        },
        { onRunForce: (kind) => ppDebugIncForceRun('listen', kind) },
      )
    }
    return this.listenForceRunner
  }

  private tryCodeForceHook(peer: Peer) {
    const runner = this.ensureHostSignalRunner()
    const now = Date.now()
    if (!mayHostForceHook(now, this.lastCodeForceHookAt, runner.runnerBusy())) return
    this.lastCodeForceHookAt = now
    runner.hook(peerAsForceSignal(peer, 'code'), false)
  }

  private handleHostPeerSignalDisconnected(peer: Peer, side: 'code' | 'listen') {
    if (takePeerForceDisconnect(peer)) {
      ppDebugIncSignalDropIgnoredSelf(side)
      return
    }
    ppDebugIncSignalDropExternal(side)
    this.abandonOpenDataConnForFreshPc()
    const now = Date.now()
    const hasPhones = hostHasPhones(loadHostStore())
    const armListenRecovery = this.hostRememberListenRecoveryArmed()
    if (armListenRecovery && (side === 'listen' || (side === 'code' && hasPhones))) {
      this.beginListenIdRecovery(now)
    }
    if (side === 'listen' || (side === 'code' && hasPhones)) {
      if (armListenRecovery) {
        this.ensureListenForceRunner().onSignalingDrop()
      }
      this.ensureHostSignalRunner().onSignalingDrop()
      this.hostListenStaggerUntil = hostListenStaggerUntil(now)
    } else if (side === 'code') {
      this.ensureHostSignalRunner().onSignalingDrop()
      this.hostListenStaggerUntil = hostListenStaggerUntil(now)
    }
  }

  /** Data-channel loss: mark runners unverified only — do not start listen-id recovery. */
  private markHostDualSignalingDrop() {
    const now = Date.now()
    this.ensureListenForceRunner().onSignalingDrop()
    this.ensureHostSignalRunner().onSignalingDrop()
    this.hostListenStaggerUntil = hostListenStaggerUntil(now)
  }

  private rememberAcceptOpts() {
    return {
      mainConnPhoneId: this.authenticatedRememberPhoneId,
      onReject: (reason: Parameters<typeof ppDebugIncListenReject>[0]) => {
        ppDebugIncListenReject(reason)
      },
    }
  }

  private hostHasRememberPhones(): boolean {
    return hostHasPhones(loadHostStore())
  }

  private listenReclaimRecoveryWindowActive(now = Date.now()): boolean {
    return this.listenRecoveryReclaimUntil != null && now < this.listenRecoveryReclaimUntil
  }

  private listenRecoveryActive(): boolean {
    return this.listenReclaimRecoveryWindowActive()
      || this.listenRecoveryMode
  }

  private clearListenRecoveryModeClearTimer() {
    if (this.listenRecoveryModeClearTimer != null) {
      clearTimeout(this.listenRecoveryModeClearTimer)
      this.listenRecoveryModeClearTimer = null
    }
  }

  private clearListenRecoveryState() {
    this.listenRecoveryMode = false
    this.listenRecoveryDropAt = null
    this.listenRecoveryReclaimUntil = null
    this.clearListenRecoveryReclaimTimer()
    this.clearListenRecoveryModeClearTimer()
  }

  private scheduleListenRecoveryModeClearAt(absoluteMs: number) {
    if (this.destroyed) return
    this.clearListenRecoveryModeClearTimer()
    const delay = Math.max(0, absoluteMs - Date.now())
    this.listenRecoveryModeClearTimer = window.setTimeout(() => {
      this.listenRecoveryModeClearTimer = null
      if (this.destroyed) return
      this.listenRecoveryMode = false
      this.listenRecoveryDropAt = null
      this.listenRecoveryReclaimUntil = null
      this.clearListenRecoveryReclaimTimer()
      const lp = this.listenPeer
      if (lp && !lp.destroyed) this.tickListenSignalForce(lp)
    }, delay)
  }

  private beginListenIdRecovery(at: number) {
    if (!this.hostRememberListenRecoveryArmed()) return
    this.listenRecoveryMode = true
    this.listenRecoveryDropAt = at
    this.listenRecoveryReclaimUntil = listenRecoveryReclaimUntilFromDrop(at)
    this.scheduleListenRecoveryModeClearAt(this.listenRecoveryReclaimUntil)
    ppDebugMarkListenRecoveryDrop(at)
    this.clearStaleRememberMainConnForRecovery()
    const lp = this.listenPeer
    if (lp && !lp.destroyed) {
      const serverOpenAt = peerAsForceSignal(lp, 'listen').signalPeerOpenAt?.() ?? null
      if (listenReclaimRecycleSkipsOpenSocket(!!lp.open, !!lp.disconnected, at, serverOpenAt)) {
        this.scheduleListenRecoveryReclaim(LISTEN_RECOVERY_ID_BACKOFF_MS)
        return
      }
    }
    void this.recycleListenPeerForServerReclaim()
    if (this.listenRecoveryActive() && !this.isRememberConnOnListenPeer()) {
      this.scheduleListenRecoveryReclaim(LISTEN_RECOVERY_ID_BACKOFF_MS)
    }
  }

  /** After a hard drop, PeerJS may keep conn.open while the PC is dead — that blocks listen auth accepts. */
  private clearStaleRememberMainConnForRecovery() {
    const c = this.conn
    if (!c?.open) return
    const pc = this.peerConnectionOf(c)
    const now = Date.now()
    if (!shouldClearStaleRememberMainConnForRecovery(
      this.role,
      this.hostHasRememberPhones(),
      true,
      {
        everConnected: this.everConnected,
        iceState: pc?.iceConnectionState ?? null,
        connectionState: pc?.connectionState ?? null,
        lastSeen: this.lastSeen,
        now,
        iceDisconnectedSince: this.iceDisconnectedAt,
      },
    )) return
    ppDebugIncAbandonOnSignalDrop()
    try { c.close() } catch {}
    if (this.conn === c) this.dropConn()
    if (this.everConnected && !this.destroyed) {
      this.set({ status: 'reconnecting' })
    }
  }

  private clearListenRecoveryReclaimTimer() {
    if (this.listenRecoveryReclaimTimer != null) {
      clearTimeout(this.listenRecoveryReclaimTimer)
      this.listenRecoveryReclaimTimer = null
    }
  }

  private scheduleListenRecoveryReclaim(delayMs: number) {
    if (this.destroyed || !this.listenRecoveryActive() || !this.hostRememberListenRecoveryArmed()) return
    if (this.isRememberConnOnListenPeer()) return
    this.clearListenRecoveryReclaimTimer()
    this.listenRecoveryReclaimTimer = window.setTimeout(() => {
      this.listenRecoveryReclaimTimer = null
      if (this.destroyed || !this.listenRecoveryActive()) return
      if (this.isRememberConnOnListenPeer()) return
      void this.recycleListenPeerForServerReclaim()
      if (this.destroyed || !this.listenRecoveryActive()) return
      if (this.isRememberConnOnListenPeer()) return
      this.scheduleListenRecoveryReclaim(LISTEN_RECOVERY_ID_BACKOFF_MS)
    }, delayMs)
  }

  private recycleListenPeerForServerReclaim() {
    const lp = this.listenPeer
    const dropAt = this.listenRecoveryDropAt
    const now = Date.now()
    const wrapped = lp && !lp.destroyed ? peerAsForceSignal(lp, 'listen') : null
    const serverOpenAt = wrapped?.signalPeerOpenAt?.() ?? null
    const connectStartedAt = wrapped?.signalConnectStartedAt?.() ?? null
    if (!shouldListenReclaimRecyclePeer({
      deferRecycle: this.shouldDeferListenForceRecycle(),
      listenOpen: !!lp?.open,
      listenDisconnected: !!lp?.disconnected,
      recoveryDropAt: dropAt,
      serverOpenAt,
      connectStartedAt,
      now,
    })) {
      return
    }
    if (lp && !lp.destroyed) {
      this.ensureListenForceRunner().rebindPeer()
      try { lp.destroy() } catch {}
    }
    this.listenPeer = null
    void this.bootstrapRememberListen()
  }

  private tickListenSignalForce(lp: Peer) {
    if (!this.hostHasRememberPhones() || lp.destroyed || this.listenGaveUp) return
    if (!shouldHostRememberSignalWork(typeof navigator !== 'undefined' && navigator.onLine, this.listenGaveUp)) return
    if (this.listenRecoveryMode) return
    if (!listenForceTickAllowed(this.listenPeerEverOpen, this.listenSignalUnverified())) return
    const now = Date.now()
    const codePeer = this.peer
    if (shouldDeferListenForce(!!codePeer?.open, this.hostListenStaggerUntil, now, true)) return
    const unverified = this.listenSignalUnverified()
    const peerLooksHealthy = lp.open && !lp.disconnected && !unverified
    const active = shouldRearmListenPeer({
      role: 'host',
      hasPhones: true,
      status: this.status,
      listenMissingOrDead: !lp.open,
    })
    if (listenForceRecycleDeferred(!!lp.open, !!lp.disconnected, this.listenForceSettleUntil, now)) return
    const wrapped = peerAsForceSignal(lp, 'listen')
    const started = wrapped.signalConnectStartedAt?.() ?? null
    ppDebugSetListenSocketReadyStateAgeMs(started != null ? Math.max(0, now - started) : null)
    this.ensureListenForceRunner().tick(
      wrapped,
      active,
      false,
      peerLooksHealthy,
      unverified,
      () => this.shouldDeferListenForceRecycle(),
    )
  }

  private shouldDeferListenForceRecycle(): boolean {
    return shouldDeferListenForceRecycle({
      hostRememberAuthPending: !!this.rememberHostAuth.authPending,
      hostAuthPendingStartedAt: this.rememberHostAuth.authPendingStartedAt,
      guestDialInFlight: this.inFlightDial != null,
      pendingDataConn: this.pending != null,
    })
  }

  private rearmRememberListenPeer() {
    if (this.role !== 'host' || this.destroyed) return
    const store = loadHostStore()
    if (!hostHasPhones(store)) return
    if (this.isRememberConnOnListenPeer()) {
      this.reloadRememberPhonesMap()
      return
    }
    if (!this.listenSignalUnverified()) {
      const lpHealthy = this.listenPeer
      if (lpHealthy?.open && !lpHealthy.disconnected) return
    }
    if (this.listenGaveUp) {
      if (this.listenOwnedBefore) this.clearRememberListenGiveUp()
      else return
    }
    const lp = this.listenPeer
    if (lp && !lp.destroyed) {
      if (
        !lp.open
        && this.listenSignalUnverified()
        && !this.ensureListenForceRunner().runnerBusy()
      ) {
        this.ensureListenForceRunner().hook(peerAsForceSignal(lp, 'listen'), false)
      }
      return
    }
    this.listenPeer = null
    if (Date.now() < this.listenBackoffUntil) return
    void this.bootstrapRememberListen()
  }

  reloadRememberPhonesMap() {
    const store = loadHostStore()
    if (!hostHasPhones(store) || !store) {
      this.rememberPhones = null
      return
    }
    this.rememberPhones = new Map(
      store.phones.map((p) => [p.id, { key: phoneKeyBytes(p), name: p.name }]),
    )
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
      if (this.role === 'guest' && !this.destroyed && !this.conn?.open && this.status !== 'error') {
        this.applyGuestSignalRecoveryRedial()
      }
      if (shouldHostReconnectOnOnline(this.role, this.destroyed)) {
        const peer = this.peer
        if (peer && !peer.destroyed) {
          this.ensureHostSignalRunner().hookOnline(peerAsForceSignal(peer, 'code'), false)
        }
      }
      if (this.role === 'host' && !this.listenGaveUp && this.hostHasRememberPhones()) {
        const lp = this.listenPeer
        if ((!lp || lp.destroyed) && Date.now() >= this.listenBackoffUntil) {
          void this.bootstrapRememberListen()
        } else if (this.listenSignalUnverified()) {
          if (this.listenRecoveryActive()) {
            if (this.hostRememberListenRecoveryArmed()) this.scheduleListenRecoveryReclaim(0)
          } else if (lp && !lp.destroyed) {
            this.ensureListenForceRunner().hookOnline(peerAsForceSignal(lp, 'listen'), false)
          }
        }
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
          if (peer && !peer.destroyed) {
            this.ensureHostSignalRunner().hook(peerAsForceSignal(peer, 'code'), false)
          }
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
      this.hostSignalRunner = new ForceSignalRunner(
        {
          setTimeout: (fn, ms) => window.setTimeout(fn, ms),
          clearTimeout: (id) => { if (id != null) window.clearTimeout(id) },
          now: () => Date.now(),
        },
        { onRunForce: (kind) => ppDebugIncForceRun('code', kind) },
      )
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
    if (this.listenGaveUp && this.hostHasRememberPhones()) return
    if (!shouldHostRememberSignalWork(typeof navigator !== 'undefined' && navigator.onLine, this.listenGaveUp)) return
    const unverified = this.hostCodeSignalUnverified()
    const peerLooksHealthy = peer.open && !peer.disconnected && !unverified
    const wrapped = peerAsForceSignal(peer, 'code')
    this.ensureHostSignalRunner().tick(
      wrapped,
      this.hostCodeSignalForceActive(peer),
      false,
      peerLooksHealthy,
      unverified,
    )
  }

  private forceHostPeerSignalReconnect() {
    const peer = this.peer
    if (!peer || peer.destroyed || this.destroyed) return
    this.tryCodeForceHook(peer)
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
    }
    this.set({ status: this.everConnected ? 'reconnecting' : 'connecting', error: '' })
    this.scheduleDial()
  }

  private abandonOpenDataConnForFreshPc() {
    const c = this.conn
    if (!c?.open) return
    const pc = this.peerConnectionOf(c)
    const now = Date.now()
    if (
      !shouldAbandonOpenDataConn({
        everConnected: this.everConnected,
        dataConnOpen: true,
        iceState: pc?.iceConnectionState ?? null,
        connectionState: pc?.connectionState ?? null,
        lastSeen: this.lastSeen,
        now,
        iceDisconnectedSince: this.iceDisconnectedAt,
      })
    ) return
    ppDebugIncAbandonOnSignalDrop()
    try { c.close() } catch {}
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
    const gen = ppDebugRecordDataConnected()
    const onIce = () => {
      this.handleGuestIce(pc)
      const state = pc.iceConnectionState
      if (state === 'connected' || state === 'completed') {
        void ppDebugRecordIceTransport(pc, gen)
      }
    }
    pc.addEventListener('iceconnectionstatechange', onIce)
    const onPeerIce = () => onIce()
    c.on('iceStateChanged', onPeerIce)
    this.iceWatchCleanup = () => {
      pc.removeEventListener('iceconnectionstatechange', onIce)
      c.off('iceStateChanged', onPeerIce)
    }
    this.handleGuestIce(pc)
    if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
      void ppDebugRecordIceTransport(pc, gen)
    }
  }

  async start() {
    this.clearTickTimers()
    if (this.peer) this.ensureHostSignalRunner().rebindPeer()
    const config = await loadRtcConfiguration()
    if (this.destroyed) return
    this.bindNetworkWatchers()
    const id = this.role === 'host' ? peerIdForCode(this.code) : undefined
    const peer = id ? new Peer(id, { ...SIGNAL, config }) : new Peer({ ...SIGNAL, config })
    this.peer = peer
    peer.on('open', () => {
      if (this.role === 'host') this.ensureHostSignalRunner().onOpen()
      else ppDebugIncGuestSocketOpen()
      this.hostIdReclaimSince = null
      this.hostUnavailableRetry = 0
      this.retry = 0
      if (this.role === 'host') {
        this.hostFails = 0
        const st = this.conn?.open ? 'connected' : 'waiting'
        this.set({ status: st, error: '' })
      } else if (this.role === 'guest' && !this.conn?.open && this.status !== 'error') {
        if (this.everConnected || guestShouldRedialOnPeerOpen(this.role, this.status, false)) {
          this.applyGuestSignalRecoveryRedial()
        }
      }
    })
    peer.on('connection', (c) => {
      if (this.role !== 'host') { c.close(); return }
      if (this.rememberHostAuth.authPending) {
        try { c.close() } catch {}
        return
      }
      if (this.conn && this.conn !== c) { try { this.conn.close() } catch {} }
      if (!c.open) this.set({ status: 'connecting' })
      this.attach(c)
    })
    peer.on('call', (call) => this.routeIncomingCall(call))
    if (this.role === 'host') trackCodePeerSocketOpen(peer)
    peer.on('disconnected', () => {
      if (this.destroyed) return
      if (this.role === 'host' && this.everConnected) {
        const now = Date.now()
        const started = ensureHostReclaimStarted(true, this.hostIdReclaimSince, now)
        if (started !== this.hostIdReclaimSince) {
          this.hostIdReclaimSince = started
          this.hostUnavailableRetry = 0
        }
        this.handleHostPeerSignalDisconnected(peer, 'code')
      } else {
        this.abandonOpenDataConnForFreshPc()
      }
      const keepHostUi =
        this.role === 'host' && hostKeepsConnectedStatusOnSignalDrop(!!this.conn?.open)
      if (!keepHostUi) {
        this.set({ status: this.everConnected ? 'reconnecting' : this.status })
      }
      window.setTimeout(() => {
        if (this.role === 'host') {
          if (peer === this.peer && !this.destroyed) {
          this.forceHostPeerSignalReconnect()
        }
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
          this.ensureHostSignalRunner().rebindPeer()
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
        if (this.role === 'guest' && this.dialTarget) ppDebugRememberDialError('peer-unavailable')
        this.releaseInFlightDial()
        this.dropConn()
        if (guestFailFastOnPeerUnavailable(this.role, this.everConnected)) {
          this.failGuestHostNotFound()
          return
        }
        if (this.everConnected && this.guestUnavailableSince == null) {
          this.guestUnavailableSince = Date.now()
        }
        this.retry++
        if (
          guestUnavailableShouldGiveUp(
            this.everConnected,
            this.retry,
            this.guestUnavailableSince,
            Date.now(),
          )
        ) {
          this.failGuestHostNotFound()
          return
        }
        this.set({ status: 'reconnecting' })
        this.scheduleDial()
        return
      }
      if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') {
        if (this.role === 'guest' && this.dialTarget) ppDebugRememberDialError(String(t))
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
    if (this.role === 'host') {
      this.bindHostListenRearmWatchers()
      void this.bootstrapRememberListen(config)
    }
  }

  refreshRememberListen(stopListen = false) {
    if (this.authTimer) clearTimeout(this.authTimer)
    this.authTimer = null
    if (stopListen) {
      this.ensureListenForceRunner().rebindPeer()
      this.ensureListenForceRunner().endUnverifiedForcing()
      try { this.listenPeer?.destroy() } catch {}
      this.listenPeer = null
      this.rememberPhones = null
      this.listenRetry = 0
      return
    }
    if (this.isRememberConnOnListenPeer()) {
      this.reloadRememberPhonesMap()
      return
    }
    const old = this.listenPeer
    if (old) {
      this.ensureListenForceRunner().rebindPeer()
      try { old.destroy() } catch {}
    }
    this.listenPeer = null
    void this.bootstrapRememberListen()
  }

  private async bootstrapRememberListen(config?: RTCConfiguration) {
    const store = loadHostStore()
    if (!hostHasPhones(store) || !store) return
    if (this.listenGaveUp || this.listenBootstrapInFlight) return
    if (shouldDeferListenBootstrapWhileOffline(typeof navigator !== 'undefined' && navigator.onLine)) return
    if (Date.now() < this.listenBackoffUntil) return
    if (this.listenPeer && !this.listenPeer.destroyed && this.listenPeer.open) {
      this.listenBootstrapInFlight = false
      return
    }
    this.listenBootstrapInFlight = true
    ppDebugIncListenBootstrap()
    const rtc = config ?? (await loadRtcConfiguration())
    if (this.destroyed || this.listenGaveUp) {
      this.listenBootstrapInFlight = false
      return
    }
    if (Date.now() < this.listenBackoffUntil) {
      this.listenBootstrapInFlight = false
      return
    }
    if (this.listenPeer && !this.listenPeer.destroyed && this.listenPeer.open) {
      this.listenBootstrapInFlight = false
      return
    }
    this.rememberPhones = new Map(
      store.phones.map((p) => [p.id, { key: phoneKeyBytes(p), name: p.name }]),
    )
    const now = Date.now()
    const listenReclaiming = this.listenOwnedBefore && this.listenReclaimStartedAt != null
    if (!listenReclaiming && !canOpenRememberListenSocket(
      this.listenGaveUp,
      this.listenUnavailableFailureTimes,
      now,
      this.listenOwnedBefore,
    )) {
      this.markListenGaveUp()
      this.listenBootstrapInFlight = false
      return
    }
    this.listenSocketsOpened++
    ppDebugIncListenWsCreated()
    const id = listenPeerId(store.listenId)
    const peer = new Peer(id, { ...SIGNAL, config: rtc })
    const prev = this.listenPeer
    if (prev && prev !== peer) {
      this.ensureListenForceRunner().rebindPeer()
      try { prev.destroy() } catch {}
    }
    this.listenPeer = peer
    this.listenPeerEverOpen = false
    this.listenBootstrapInFlight = false
    trackListenPeerSocketOpen(peer, () => {
      this.listenPeerEverOpen = true
      this.listenOwnedBefore = true
      this.listenReclaimStartedAt = null
      this.listenUnavailableFailures = 0
      ppDebugIncListenServerOpen()
      ppDebugRecordListenFirstServerOpenAfterDrop(Date.now())
      if (this.listenRecoveryMode) {
        this.clearListenRecoveryReclaimTimer()
        const now = Date.now()
        const plan = planListenRecoveryOnServerOpen(
          true,
          now,
          this.listenRecoveryReclaimUntil,
        )
        if (plan.endUnverifiedForcing) {
          this.ensureListenForceRunner().endUnverifiedForcing(
            true,
            this.listenRecoveryReclaimUntil,
            now,
          )
        }
        if (plan.settleUntil != null) {
          this.listenForceSettleUntil = plan.settleUntil
        }
        if (plan.clearRecoveryModeAt != null) {
          this.scheduleListenRecoveryModeClearAt(plan.clearRecoveryModeAt)
        }
      } else if (this.listenForceRunner?.isUnverifiedAfterDrop()) {
        this.listenForceSettleUntil = Date.now() + FORCE_LISTEN_SETTLE_MS
      }
      this.ensureListenForceRunner().onOpen()
    })
    peer.on('connection', (c) => {
      if (this.role !== 'host' || this.destroyed) { try { c.close() } catch {}; return }
      ppDebugIncListenIncomingConn()
      c.on('open', () => ppDebugIncListenConnOpened())
      if (!this.rememberHostAuth.canAcceptConnection(c, this.conn, this.rememberAcceptOpts())) {
        try { c.close() } catch {}
        return
      }
      this.attachRememberHost(c)
    })
    peer.on('call', (call) => this.routeIncomingCall(call))
    peer.on('disconnected', () => {
      if (this.destroyed) return
      const lp = this.listenPeer
      if (!lp || lp !== peer) return
      this.handleHostPeerSignalDisconnected(peer, 'listen')
    })
    peer.on('error', (e: any) => {
      if (e?.type !== 'unavailable-id' || this.destroyed) return
      ppDebugIncListenSocketUnavailableId()
      const t = Date.now()
      this.listenReclaimStartedAt = ensureListenReclaimStarted(
        this.listenOwnedBefore,
        this.listenReclaimStartedAt,
        t,
      )
      this.listenRetry++
      this.listenUnavailableFailures++
      this.listenUnavailableFailureTimes.push(t)
      const recovery = this.listenRecoveryActive()
      const delay = listenBackoffForClaim(
        this.listenRetry,
        this.listenOwnedBefore,
        this.listenReclaimStartedAt,
        hostUnavailableIdBackoffMs,
        recovery,
      )
      this.listenBackoffUntil = t + delay
      this.ensureListenForceRunner().rebindPeer()
      try { peer.destroy() } catch {}
      if (this.listenPeer === peer) this.listenPeer = null
      if (listenClaimShouldGiveUp(
        this.listenUnavailableFailures,
        this.listenSocketsOpened,
        this.listenOwnedBefore,
        this.listenReclaimStartedAt,
        t,
        recovery,
      )) {
        this.markListenGaveUp()
        return
      }
      if (recovery) this.scheduleListenRecoveryReclaim(delay)
      window.setTimeout(() => {
        if (!this.destroyed && !this.listenGaveUp) void this.bootstrapRememberListen(rtc)
      }, delay)
    })
  }

  get hadGuest() {
    return this.role === 'host' && this.everConnected
  }

  async restartHost() {
    if (this.role !== 'host' || this.destroyed) return
    this.clearListenRecoveryState()
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
    this.ensureHostSignalRunner().rebindPeer()
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
    this.guestUnavailableSince = null
    ppDebugRecordGuestRedial(0)
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
    this.clearListenRecoveryState()
    this.timers.forEach(clearInterval)
    this.timers = []
    if (this.dialWait) clearTimeout(this.dialWait)
    if (this.hostGrace) clearTimeout(this.hostGrace)
    this.hostGrace = null
    try { this.conn?.send({ t: 'bye' }) } catch {}
    try { this.conn?.close() } catch {}
    this.conn = null
    this.closePending()
    this.ensureHostSignalRunner().rebindPeer()
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
    this.connPeer = null
    this.authenticatedRememberPhoneId = null
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

  private applyGuestSignalRecoveryRedial() {
    if (this.role !== 'guest' || this.destroyed || this.status === 'error') return
    if (this.conn?.open) return
    const plan = guestRedialPlanAfterSignalRecovery(this.everConnected)
    this.retry = plan.retry
    this.guestUnavailableSince = null
    if (this.dialWait) {
      clearTimeout(this.dialWait)
      this.dialWait = null
    }
    ppDebugRecordGuestRedial(plan.delayMs)
    if (plan.delayMs <= 0) this.dial()
    else {
      this.dialWait = window.setTimeout(() => {
        this.dialWait = null
        this.dial()
      }, plan.delayMs)
    }
  }

  private scheduleDial() {
    if (this.status === 'error' || this.dialWait || this.hasInFlightDial()) return
    const delay = redialDelayMs(this.retry, this.everConnected)
    ppDebugRecordGuestRedial(delay)
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
    const err = this.rememberGuestAuth || this.dialTarget ? MSG_REMEMBER_UNREACHABLE : MSG_HOST_NOT_FOUND
    this.set({ status: 'error', error: err })
  }

  private clearStaleConnForGuestRememberDial() {
    if (!this.conn?.open || !this.rememberGuestAuth) return
    const pc = this.peerConnectionOf(this.conn)
    if (
      !guestRememberDialShouldClearOpenConn({
        rememberGuest: true,
        status: this.status,
        everConnected: this.everConnected,
        dataConnOpen: true,
        iceState: pc?.iceConnectionState ?? null,
        connectionState: pc?.connectionState ?? null,
        lastSeen: this.lastSeen,
        now: Date.now(),
      })
    ) return
    try { this.conn.close() } catch {}
  }

  private dial() {
    if (this.destroyed || this.status === 'error') return
    this.clearStaleConnForGuestRememberDial()
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
        if (peer.disconnected) {
          ppDebugIncGuestForce('tick')
          peer.reconnect()
        }
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
    if (this.dialTarget) ppDebugRememberDial(this.dialTarget)
    const c = peer.connect(target, { reliable: true, serialization: 'binary' })
    const ms = dialOpenTimeoutMs(isRelayOnly(), !!this.rememberGuestAuth)
    this.inFlightDial = c
    this.pending = c
    this.inFlightDialUntil = Date.now() + ms
    this.attach(c)
    this.dialHangTimer = window.setTimeout(() => {
      this.dialHangTimer = null
      if (!this.destroyed && this.inFlightDial === c && !c.open) {
        if (this.rememberGuestAuth) ppDebugRememberDialError('dial-timeout')
        if (this.authPending?.conn === c) this.clearAuthPending()
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
    if (this.role === 'host' || c.open) {
      this.conn = c
      this.connPeer = this.peer
    }
    const onOpen = () => {
      if (c !== this.inFlightDial && c !== this.pending && c !== this.conn) return
      this.lastSeen = Date.now()
      this.everConnected = true
      this.sessionPaired = true
      this.retry = 0
      this.guestUnavailableSince = null
      this.hostFails = 0
      if (this.dialHangTimer) { clearTimeout(this.dialHangTimer); this.dialHangTimer = null }
      this.inFlightDial = null
      this.inFlightDialUntil = 0
      this.pending = null
      this.conn = c
      this.connPeer = this.peer
      if (this.hostGrace) { clearTimeout(this.hostGrace); this.hostGrace = null }
      if (this.role === 'host') {
        notifyHostPhoneConnected(this.listenForceRunner, this.hostSignalRunner)
      }
      c.send({ t: 'hello', name: deviceName() })
      this.set({ status: 'connected', error: '' })
      if (this.role === 'host' && !this.rememberGuestAuth) this.clearRememberListenGiveUp()
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
      if (this.role === 'host') {
        this.ensureListenForceRunner().endUnverifiedForcing()
        this.ensureHostSignalRunner().endUnverifiedForcing()
      }
      this.set({ status: this.role === 'host' ? 'waiting' : 'closed' })
      try { c.close() } catch {}
      return
    }
    if (m.t === 'remember:forget') {
      const phoneId = String(m.phoneId ?? '')
      const msgListenId = String(m.listenId ?? '')
      if (this.role === 'host' && phoneId) {
        const store = loadHostStore()
        const fromListen = this.isRememberConnOnListenPeer()
        const fromCode = !fromListen && !!(this.conn?.open && this.conn === c && this.connPeer === this.peer && this.sessionPaired)
        if (!hostAcceptsPhoneForget({
          fromListenPeer: fromListen,
          fromCodePeer: fromCode,
          storeListenId: store?.listenId ?? null,
          msgListenId,
          authenticatedPhoneId: this.authenticatedRememberPhoneId,
          phoneId,
          phoneKnown: !!store?.phones.some((p) => p.id === phoneId),
        })) return
        if (store?.phones.some((p) => p.id === phoneId)) {
          const { next, stopListen } = forgetHostPhoneRecord(store, phoneId)
          saveHostStore(next)
          this.refreshRememberListen(stopListen)
        }
      }
      if (this.role === 'guest') {
        const listenId = String(m.listenId ?? '')
        if (listenId && phoneId) {
          const store = loadGuestStore()
          if (guestForgetMatchesSavedLaptop(store, listenId, phoneId)) {
            saveGuestStore(forgetGuestLaptopRecord(store, listenId))
          }
        }
      }
      return
    }
    this.msgHandlers.forEach((h) => h(m))
  }

  private armAuthTimeout(c: DataConnection) {
    if (c !== this.authPending?.conn) return
    if (this.authTimer) clearTimeout(this.authTimer)
    this.authTimer = window.setTimeout(() => this.failRememberAuth(c), REMEMBER_PROOF_TIMEOUT_MS)
  }

  private failRememberAuth(c: DataConnection, reason: HostAuthFailReason = 'fail') {
    if (this.role === 'host') {
      if (c === this.rememberHostAuth.authPending?.conn) this.rememberHostAuth.clear()
      try { c.close() } catch {}
      return
    }
    if (c !== this.authPending?.conn) return
    if (guestRememberKeepLiveOnAuthFail(true) && this.conn?.open && reason !== 'denied') {
      this.clearAuthPending()
      try { c.close() } catch {}
      if (!this.hasInFlightDial()) this.scheduleDial()
      return
    }
    this.clearAuthPending()
    try { c.close() } catch {}
    if (reason === 'denied') {
      this.releaseInFlightDial()
      if (this.dialWait) clearTimeout(this.dialWait)
      this.dialWait = null
      this.set({ status: 'error', error: MSG_REMEMBER_DENIED })
      return
    }
    this.rememberGuestFailCount++
    if (!this.rememberGuestEverAuthed && !this.sessionPaired && this.rememberGuestFailCount >= 3) {
      this.releaseInFlightDial()
      if (this.dialWait) clearTimeout(this.dialWait)
      this.dialWait = null
      this.set({ status: 'error', error: MSG_REMEMBER_UNREACHABLE })
      return
    }
    const nextStatus = this.rememberGuestAuth && !this.sessionPaired ? 'connecting' : 'reconnecting'
    this.set({ status: nextStatus, error: '' })
    if (!this.hasInFlightDial()) this.scheduleDial()
  }

  private promoteConnected(c: DataConnection, remoteHint?: string, fromListenPeer = false, rememberPhoneId?: string) {
    const fromAuth = this.authPending?.conn === c
    if (this.conn?.open && this.conn !== c) {
      if (
        fromListenPeer
        && rememberPhoneId
        && rememberPhoneId === this.authenticatedRememberPhoneId
      ) {
        try { this.conn.close() } catch {}
        this.dropConn()
      } else {
        const action = guestRememberSwapOnPromote(!!this.conn?.open, this.conn === c, fromAuth)
        if (action === 'swap') {
          try { this.conn.close() } catch {}
        } else if (action === 'reject-new') {
          try { c.close() } catch {}
          return
        }
      }
    }
    if (!canPromoteDataConn({
      fromGuestAuthPending: fromAuth,
      fromRememberListen: fromListenPeer,
      conn: c,
      inFlightDial: this.inFlightDial,
      pending: this.pending,
      liveConn: this.conn,
    })) return
    this.lastSeen = Date.now()
    this.everConnected = true
    this.retry = 0
    this.guestUnavailableSince = null
    this.hostFails = 0
    if (this.dialHangTimer) { clearTimeout(this.dialHangTimer); this.dialHangTimer = null }
    this.inFlightDial = null
    this.inFlightDialUntil = 0
    this.pending = null
    this.clearAuthPending()
    this.conn = c
    this.connPeer = fromListenPeer ? this.listenPeer : this.peer
    if (fromListenPeer && rememberPhoneId) this.authenticatedRememberPhoneId = rememberPhoneId
    if (this.role === 'host') {
      notifyHostPhoneConnected(this.listenForceRunner, this.hostSignalRunner)
      this.clearListenRecoveryState()
      if (fromListenPeer) {
        this.listenForceSettleUntil = null
      }
    }
    this.sessionPaired = true
    this.rememberGuestFailCount = 0
    if (this.role === 'guest' && this.rememberGuestAuth) {
      this.rememberGuestEverAuthed = true
      this.rememberGuestDeadlineMs = 0
    }
    if (this.hostGrace) { clearTimeout(this.hostGrace); this.hostGrace = null }
    try { c.send({ t: 'hello', name: deviceName() }) } catch {}
    if (remoteHint) this.set({ remoteName: remoteHint })
    this.set({ status: 'connected', error: '' })
    if (this.role === 'guest') {
      if (this.code) rememberGuestPairedCode(this.code)
      this.clearGuestWatchdog()
    }
    this.wireIceRecovery(c)
    void this.refreshConnRelay()
  }

  private attachRememberGuest(c: DataConnection) {
    const authAction = guestRememberIncomingAuthAction(!!this.conn?.open, !!this.authPending)
    if (authAction === 'reject-incoming') {
      try { c.close() } catch {}
      return
    }
    if (this.conn && !this.conn.open) this.dropConn()
    this.authPending = { conn: c, phase: 'await-hello', phoneNonce: null, hostNonce: null }
    const greet = () => {
      if (c !== this.authPending?.conn || !this.rememberGuestAuth) return
      ppDebugRememberDialOpened()
      const phoneNonce = randomBytes(32)
      this.authPending = { conn: c, phase: 'await-proof', phoneNonce, hostNonce: null }
      try {
        c.send({
          t: 'remember:hello',
          phoneId: this.rememberGuestAuth.phoneId,
          phoneNonce: bytesToB64(phoneNonce),
        })
        ppDebugRememberAuthSent()
      } catch {
        ppDebugRememberDialError('dial-error')
      }
      this.armAuthTimeout(c)
      const next = this.conn?.open
        ? 'connected'
        : this.everConnected
          ? 'reconnecting'
          : 'connecting'
      this.set({ status: next })
    }
    if (c.open) greet(); else c.on('open', greet)
    c.on('data', async (m: any) => {
      if (c === this.authPending?.conn) {
        if (!m || typeof m !== 'object') return
        if (m.t === 'remember:denied') {
          this.failRememberAuth(c, 'denied')
          return
        }
        if (m.t === 'remember:challenge' && typeof m.nonce === 'string' && this.rememberGuestAuth && this.authPending.phoneNonce) {
          const hostNonce = bytesFromB64(m.nonce)
          const phoneNonce = this.authPending.phoneNonce
          this.authPending = { ...this.authPending, hostNonce }
          const proof = await signPhoneProof(
            this.rememberGuestAuth.key,
            phoneNonce,
            hostNonce,
          )
          if (c !== this.authPending?.conn || !c.open) return
          try { c.send({ t: 'remember:proof', proof: bytesToB64(proof) }) } catch {}
          return
        }
        if (m.t === 'remember:ok' && this.rememberGuestAuth && this.authPending.phoneNonce && this.authPending.hostNonce) {
          const { phoneNonce, hostNonce } = this.authPending
          const ok = await guestAcceptsRememberOk(m, this.rememberGuestAuth.key, hostNonce, phoneNonce)
          if (c !== this.authPending?.conn || !c.open) return
          if (!ok) {
            this.failRememberAuth(c, 'fail')
            return
          }
          this.promoteConnected(c)
          return
        }
        return
      }
      if (c === this.conn) this.dispatchPayload(m, c)
    })
    c.on('close', () => {
      if (this.rememberGuestAuth && (c === this.inFlightDial || c === this.authPending?.conn) && !c.open) {
        ppDebugRememberDialError('dial-closed')
      }
      this.lost(c)
    })
    c.on('error', () => {
      if (this.rememberGuestAuth && c === this.inFlightDial) ppDebugRememberDialError('dial-error')
      this.lost(c)
    })
  }

  private hostAuthCallbacks(): import('../remember/hostAuth').HostAuthCallbacks {
    return {
      onPromote: (conn, remoteName, phoneId) => {
        ppDebugIncListenAuthCompleted()
        this.listenForceSettleUntil = null
        this.promoteConnected(conn as DataConnection, remoteName, true, phoneId)
      },
      onFail: (conn, reason) => this.failRememberAuth(conn as DataConnection, reason),
      onDispatch: (conn, m) => this.dispatchPayload(m as any, conn as DataConnection),
      onTimeout: (conn) => this.failRememberAuth(conn as DataConnection, 'fail'),
    }
  }

  private attachRememberHost(c: DataConnection) {
    if (this.conn && !this.conn.open) this.dropConn()
    ppDebugIncListenAuthStarted()
    const cb = this.hostAuthCallbacks()
    this.rememberHostAuth.beginAuth(c, this.conn, cb, this.rememberAcceptOpts())
    c.on('data', (m: any) => {
      void this.rememberHostAuth.handleData(c, m, this.rememberPhones, this.conn, cb, this.rememberAcceptOpts())
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
      const peer = this.peer
      if (this.role === 'host' && hostHasPhones(loadHostStore()) && !this.conn?.open) {
        this.markHostDualSignalingDrop()
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
            if (!this.conn?.open && !this.destroyed) {
              this.set({ status: 'waiting' })
              if (this.listenSignalUnverified()) this.rearmRememberListenPeer()
            }
          }, 15000)
        }
        if (this.listenSignalUnverified()) this.rearmRememberListenPeer()
      } else {
        this.set({ status: 'waiting' })
        if (this.listenSignalUnverified()) this.rearmRememberListenPeer()
      }
    }
    else if (!this.hasInFlightDial()) {
      const next = this.rememberGuestAuth && !this.sessionPaired ? 'connecting' : 'reconnecting'
      this.set({ status: next })
      this.scheduleDial()
    }
  }

  private tickRememberGuestHome() {
    if (!this.rememberGuestDeadlineMs || this.destroyed) return
    const now = Date.now()
    if (!shouldFailRememberGuestHome({
      rememberGuest: !!this.rememberGuestAuth,
      sessionPaired: this.sessionPaired,
      rememberEverAuthed: this.rememberGuestEverAuthed,
      status: this.status,
      deadlineMs: this.rememberGuestDeadlineMs,
      now,
    })) return
    this.failRememberGuestHome()
  }

  private failRememberGuestHome() {
    const c = this.authPending?.conn ?? this.inFlightDial ?? this.conn
    this.clearAuthPending()
    if (c) {
      try { c.close() } catch {}
    }
    this.releaseInFlightDial()
    this.dropConn()
    if (this.dialWait) clearTimeout(this.dialWait)
    this.dialWait = null
    this.rememberGuestDeadlineMs = 0
    if (this.role === 'guest') this.sessionPaired = false
    this.set({ status: 'error', error: MSG_REMEMBER_UNREACHABLE })
  }

  private tickGuestWatchdog() {
    this.tickRememberGuestHome()
    if (this.role !== 'guest' || this.destroyed || this.status === 'error') return
    if (
      (this.status !== 'connecting' && this.status !== 'reconnecting')
      || this.conn?.open
    ) return
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
    ppDebugIncGuestForce('tick')
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
    const lp = this.listenPeer
    const store = loadHostStore()
    if (
      this.role === 'host'
      && shouldTickBootstrapListen({
        hasPhones: !!hostHasPhones(store),
        listenMissing: !lp || !!lp.destroyed,
        listenGaveUp: this.listenGaveUp,
        bootstrapInFlight: this.listenBootstrapInFlight,
        backoffUntil: this.listenBackoffUntil,
        now: Date.now(),
      })
    ) {
      void this.bootstrapRememberListen()
    } else if (this.role === 'host' && lp && !lp.destroyed) {
      this.tickListenSignalForce(lp)
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
  get rememberListenId() { return this.rememberGuestAuth?.listenId }

  send(m: any) {
    if (!this.rememberGuestLive()) return
    const guestPen = this.authPending?.conn === this.conn ? this.authPending : null
    const hostPen = this.rememberHostAuth.authPending?.conn === this.conn ? this.rememberHostAuth.authPending : null
    if (!shouldLinkSend(this.conn, guestPen || hostPen)) return
    try { this.conn!.send(m) } catch {}
  }

  call(stream: MediaStream, kind: string) {
    if (!this.rememberGuestLive()) throw new Error('Not connected')
    if (connBlockedByRememberAuth(
      this.conn,
      this.authPending?.conn,
      this.rememberHostAuth.authPending?.conn,
    )) throw new Error('Not connected')
    if (!this.peer || !this.remoteId) throw new Error('Not connected')
    const outbound = peerForOutboundCall(this.connPeer, this.peer)
    if (!outbound) throw new Error('Not connected')
    return outbound.call(this.remoteId, stream, { metadata: { kind } })
  }

  disconnect() {
    if (linkTeardownSendsBye('disconnect')) {
      try { this.conn?.send({ t: 'bye' }) } catch {}
    }
    this.clearListenRecoveryState()
    if (this.role === 'host') {
      this.ensureListenForceRunner().endUnverifiedForcing()
      this.ensureHostSignalRunner().endUnverifiedForcing()
    }
    this.set({ status: this.role === 'host' ? 'waiting' : 'closed' })
    if (this.role === 'guest') this.sessionPaired = false
    const c = this.conn
    this.conn = null
    window.setTimeout(() => { try { c?.close() } catch {} }, 200)
  }

  destroy() {
    this.visibilityListener?.()
    this.visibilityListener = null
    this.networkListener?.()
    this.networkListener = null
    this.listenForceRunner?.stop()
    this.listenForceRunner = null
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
    this.clearAuthPending()
    this.clearListenRecoveryState()
    try { this.listenPeer?.destroy() } catch {}
    this.listenPeer = null
    this.peer?.destroy()
  }
}
