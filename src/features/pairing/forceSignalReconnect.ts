import {
  forceSignalWatchdogDelayMs,
  mayForceRecycleOpenSignalSocket,
  WS_OPEN,
  type ForceSignalPeerStateExt,
} from './forceSignalPeerState.ts'

export const FORCE_SIGNAL_OPEN_WATCHDOG_MS = 3000
export const FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS = 3000
export const FORCE_SIGNAL_CONNECTING_GRACE_MS = 10_000

export function forceSignalConnectingGraceMs(unverifiedAfterDrop: boolean): number {
  return unverifiedAfterDrop
    ? FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS
    : FORCE_SIGNAL_CONNECTING_GRACE_MS
}
export const FORCE_SIGNAL_DROP_HOOK_FAST_PHASE_MS = 2 * 60_000
export const FORCE_SIGNAL_DROP_HOOK_CAP_MS = 5000
export const FORCE_SIGNAL_RECLAIM_MIN_MS = 75_000
export const FORCE_SIGNAL_VERIFY_CADENCE_MS = 12_000
export const FORCE_SIGNAL_VERIFY_SLOW_CADENCE_MS = 60_000
export const FORCE_SIGNAL_VERIFY_FAST_PHASE_MS = 5 * 60_000
export const FORCE_SIGNAL_VISIBILITY_MIN_MS = 30_000

export type ForceSignalPeerLike = {
  destroyed: boolean
  disconnected: boolean
  open: boolean
  disconnect: () => void
  reconnect: () => void
  signalReadyState?: () => number | null
  signalConnectStartedAt?: () => number | null
}

export function forceSignalReconnect(peer: ForceSignalPeerLike): boolean {
  if (peer.destroyed) return false
  try {
    if (!peer.disconnected) peer.disconnect()
    peer.reconnect()
    return true
  } catch {
    return false
  }
}

export function forceSignalReconnectBackoffMs(attempt: number): number {
  if (attempt <= 1) return 1000
  if (attempt === 2) return 2000
  if (attempt === 3) return 4000
  if (attempt === 4) return 8000
  return 10_000
}

/** Drop-hook / post-outage retries: 1s, 2s, 4s, 5s, 5s, … for 2m, then 10s. */
export function forceSignalDropHookBackoffMs(
  attempt: number,
  dropStartedAt: number | null,
  now: number,
): number {
  if (dropStartedAt != null && now - dropStartedAt >= FORCE_SIGNAL_DROP_HOOK_FAST_PHASE_MS) {
    return 10_000
  }
  if (attempt <= 1) return 1000
  if (attempt === 2) return 2000
  if (attempt === 3) return 4000
  return FORCE_SIGNAL_DROP_HOOK_CAP_MS
}

export function forceSignalUnverifiedIntervalMs(elapsedSinceDropMs: number): number {
  if (elapsedSinceDropMs < FORCE_SIGNAL_VERIFY_FAST_PHASE_MS) return FORCE_SIGNAL_VERIFY_CADENCE_MS
  return FORCE_SIGNAL_VERIFY_SLOW_CADENCE_MS
}

export function forceSignalCadenceDue(
  dropStartedAt: number | null,
  lastCadenceAt: number | null,
  now: number,
): boolean {
  if (dropStartedAt == null) return false
  const elapsed = now - dropStartedAt
  const interval = forceSignalUnverifiedIntervalMs(elapsed)
  const anchor = lastCadenceAt ?? dropStartedAt
  return now - anchor >= interval
}

export function shouldForceSignalOnVisibility(hiddenMs: number, unverified: boolean): boolean {
  if (!unverified) return false
  return hiddenMs > FORCE_SIGNAL_VISIBILITY_MIN_MS
}

export function signalPeerNeedsForce(peer: ForceSignalPeerLike, peerHealthy: boolean): boolean {
  if (peer.destroyed) return false
  if (peer.open && peerHealthy) return false
  return true
}

export function forceReclaimExpired(reclaimStartedAt: number | null, now: number, minMs = FORCE_SIGNAL_RECLAIM_MIN_MS): boolean {
  if (reclaimStartedAt == null) return false
  return now - reclaimStartedAt >= minMs
}

export type ForceSignalTimers = {
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (id: number | null) => void
  now: () => number
}

type ForceMode = 'hook' | 'tick' | 'cadence' | 'online'

export type RunForceKind = ForceMode | 'retry'

export type ForceSignalRunnerOpts = {
  reclaimMinMs?: number
  onRunForce?: (kind: RunForceKind) => void
}

export class ForceSignalRunner {
  private attempt = 0
  private watchdogId: number | null = null
  private retryId: number | null = null
  private reclaimStartedAt: number | null = null
  private dropStartedAt: number | null = null
  /** Hook retry anchor survives post-settle cadence moves on dropStartedAt. */
  private dropHookAnchorAt: number | null = null
  private lastCadenceAt: number | null = null
  private silentOpenWatchUntil: number | null = null
  private unverifiedAfterDrop = false
  private stopped = false
  private timers: ForceSignalTimers
  private reclaimMinMs: number
  private onRunForce?: (kind: RunForceKind) => void
  restoreSignalAt: number | null = null

  constructor(
    timers: ForceSignalTimers,
    reclaimMinMsOrOpts: number | ForceSignalRunnerOpts = FORCE_SIGNAL_RECLAIM_MIN_MS,
  ) {
    this.timers = timers
    if (typeof reclaimMinMsOrOpts === 'number') {
      this.reclaimMinMs = reclaimMinMsOrOpts
    } else {
      this.reclaimMinMs = reclaimMinMsOrOpts.reclaimMinMs ?? FORCE_SIGNAL_RECLAIM_MIN_MS
      this.onRunForce = reclaimMinMsOrOpts.onRunForce
    }
  }

  stop() {
    this.stopped = true
    this.dropHookAnchorAt = null
    this.clearTimers()
  }

  clearTimers() {
    if (this.watchdogId != null) {
      this.timers.clearTimeout(this.watchdogId)
      this.watchdogId = null
    }
    if (this.retryId != null) {
      this.timers.clearTimeout(this.retryId)
      this.retryId = null
    }
  }

  runnerBusy(): boolean {
    return this.watchdogId != null || this.retryId != null
  }

  isUnverifiedAfterDrop(): boolean {
    return this.unverifiedAfterDrop
  }

  onSignalingDrop() {
    const now = this.timers.now()
    this.unverifiedAfterDrop = true
    this.dropStartedAt = now
    this.dropHookAnchorAt = now
    this.lastCadenceAt = null
  }

  onPhoneConnected() {
    this.dropHookAnchorAt = null
    this.endUnverifiedForcing()
    this.attempt = 0
    this.reclaimStartedAt = null
  }

  endUnverifiedForcing(
    preserveSilentOpenWatch = false,
    silentWatchUntil: number | null = null,
    cadenceAnchorAt: number | null = null,
  ) {
    this.unverifiedAfterDrop = false
    if (!preserveSilentOpenWatch) {
      this.dropStartedAt = null
      this.lastCadenceAt = null
      this.silentOpenWatchUntil = null
    } else {
      this.silentOpenWatchUntil = silentWatchUntil
      if (cadenceAnchorAt != null) {
        this.dropStartedAt = cadenceAnchorAt
        this.dropHookAnchorAt = null
        this.lastCadenceAt = null
      }
    }
    this.clearTimers()
  }

  dropHookBackoffAnchor(): number | null {
    return this.dropHookAnchorAt
  }

  hasPostSettleSilentOpenWatch(): boolean {
    return !this.unverifiedAfterDrop && this.dropStartedAt != null
  }

  onOpen() {
    this.attempt = 0
    this.reclaimStartedAt = null
    this.clearTimers()
  }

  /** Clear in-flight timers when the underlying Peer instance is swapped. */
  rebindPeer() {
    this.attempt = 0
    this.clearTimers()
  }

  hookOnline(peer: ForceSignalPeerStateExt, idReclaimCap = false) {
    if (this.stopped || peer.destroyed) return
    this.clearTimers()
    this.attempt = 0
    const onlineAt = this.timers.now()
    this.runForce(peer, idReclaimCap, 'online', onlineAt)
  }

  hook(peer: ForceSignalPeerStateExt, idReclaimCap: boolean): void {
    if (this.stopped || peer.destroyed) return
    if (this.watchdogId != null || this.retryId != null) return
    const now = this.timers.now()
    if (idReclaimCap) this.reclaimStartedAt ??= now
    if (idReclaimCap && forceReclaimExpired(this.reclaimStartedAt, now, this.reclaimMinMs)) return
    this.clearTimers()
    this.attempt = 0
    this.runForce(peer, idReclaimCap, 'hook')
  }

  tick(
    peer: ForceSignalPeerStateExt,
    active: boolean,
    idReclaimCap: boolean,
    peerLooksHealthy: boolean,
    unverifiedMode: boolean,
    deferForce?: () => boolean,
  ) {
    if (this.stopped || !active || peer.destroyed) return
    const unverified = unverifiedMode || this.unverifiedAfterDrop
    const peerHealthy = unverified ? false : peerLooksHealthy

    const now = this.timers.now()
    if (!unverified && peer.open && !peer.disconnected && this.dropStartedAt != null) {
      if (deferForce?.()) return
      if (this.silentOpenWatchUntil != null && now >= this.silentOpenWatchUntil) {
        this.dropStartedAt = null
        this.lastCadenceAt = null
        this.silentOpenWatchUntil = null
        return
      }
      if (this.watchdogId != null || this.retryId != null) this.clearTimers()
      if (
        forceSignalCadenceDue(this.dropStartedAt, this.lastCadenceAt, now)
        && this.watchdogId == null
        && this.retryId == null
      ) {
        const rs = peer.signalReadyState?.() ?? null
        const verifiedLive = peerHealthy && rs === WS_OPEN
        if (verifiedLive || !mayForceRecycleOpenSignalSocket(peer, now, this.socketReplaceOpts('cadence'))) {
          this.dropStartedAt = null
          this.lastCadenceAt = null
          this.silentOpenWatchUntil = null
          return
        }
        this.lastCadenceAt = now
        this.runForce(peer, idReclaimCap, 'cadence')
      }
      return
    }

    if (!unverified && peer.open && peerHealthy) {
      this.onOpen()
      return
    }

    if (unverified && peer.open && !peer.disconnected) {
      if (deferForce?.()) return
      if (this.watchdogId != null || this.retryId != null) this.clearTimers()
      if (this.dropStartedAt == null) return
      if (
        forceSignalCadenceDue(this.dropStartedAt, this.lastCadenceAt, now)
        && this.watchdogId == null
        && this.retryId == null
        && mayForceRecycleOpenSignalSocket(peer, now, this.socketReplaceOpts('cadence'))
      ) {
        this.lastCadenceAt = now
        this.runForce(peer, idReclaimCap, 'cadence')
      }
      return
    }

    if (unverified) {
      if (this.watchdogId != null || this.retryId != null) return
      if (!signalPeerNeedsForce(peer, false)) return
      if (!mayForceRecycleOpenSignalSocket(peer, now, this.socketReplaceOpts('tick'))) return
      this.runForce(peer, idReclaimCap, 'tick')
      return
    }

    if (idReclaimCap) {
      this.reclaimStartedAt ??= now
      if (forceReclaimExpired(this.reclaimStartedAt, now, this.reclaimMinMs)) return
    }
    if (!signalPeerNeedsForce(peer, peerHealthy)) return
    if (this.watchdogId != null || this.retryId != null) return
    if (!mayForceRecycleOpenSignalSocket(peer, now, this.socketReplaceOpts('tick'))) return
    this.runForce(peer, idReclaimCap, 'tick')
  }

  private socketReplaceOpts(mode: ForceMode, onlineAt?: number) {
    return {
      unverifiedAfterDrop: this.unverifiedAfterDrop,
      mode,
      onlineAt: onlineAt ?? this.restoreSignalAt ?? undefined,
      restoreSignalAt: this.restoreSignalAt,
    }
  }

  private hookRetryBackoff(attempt: number, mode: ForceMode, now: number): number {
    const hookAnchor = this.dropHookAnchorAt ?? this.dropStartedAt
    if (hookAnchor != null && mode !== 'cadence') {
      return forceSignalDropHookBackoffMs(attempt, hookAnchor, now)
    }
    return forceSignalReconnectBackoffMs(attempt)
  }

  private runForce(
    peer: ForceSignalPeerStateExt,
    idReclaimCap: boolean,
    mode: ForceMode,
    onlineAt?: number,
    countKind?: RunForceKind,
  ) {
    if (peer.destroyed || this.stopped) return
    const now = this.timers.now()
    const opts = this.socketReplaceOpts(mode, onlineAt)
    if (!mayForceRecycleOpenSignalSocket(peer, now, opts)) {
      this.armWatchdog(peer, idReclaimCap, mode, onlineAt)
      return
    }
    this.attempt += 1
    forceSignalReconnect(peer)
    this.onRunForce?.(countKind ?? mode)
    if (mode === 'cadence') return
    this.armWatchdog(peer, idReclaimCap, mode, onlineAt)
  }

  private armWatchdog(
    peer: ForceSignalPeerStateExt,
    idReclaimCap: boolean,
    mode: ForceMode,
    onlineAt?: number,
  ) {
    if (this.watchdogId != null) {
      this.timers.clearTimeout(this.watchdogId)
      this.watchdogId = null
    }
    const now = this.timers.now()
    const watchdogMs = forceSignalWatchdogDelayMs(
      peer,
      now,
      FORCE_SIGNAL_OPEN_WATCHDOG_MS,
      this.unverifiedAfterDrop,
    )
    this.watchdogId = this.timers.setTimeout(() => {
      this.watchdogId = null
      if (peer.destroyed || this.stopped) return
      if (peer.open && mode !== 'cadence') {
        this.clearTimers()
        return
      }
      const t = this.timers.now()
      if (!mayForceRecycleOpenSignalSocket(peer, t, this.socketReplaceOpts(mode, onlineAt))) {
        this.armWatchdog(peer, idReclaimCap, mode, onlineAt)
        return
      }
      if (idReclaimCap && forceReclaimExpired(this.reclaimStartedAt, t, this.reclaimMinMs)) return
      const delay = this.hookRetryBackoff(this.attempt, mode, t)
      if (this.retryId != null) {
        this.timers.clearTimeout(this.retryId)
        this.retryId = null
      }
      this.retryId = this.timers.setTimeout(() => {
        this.retryId = null
        if (peer.destroyed || this.stopped) return
        if (peer.open && mode !== 'cadence') {
          this.clearTimers()
          return
        }
        const retryNow = this.timers.now()
        if (!mayForceRecycleOpenSignalSocket(peer, retryNow, this.socketReplaceOpts(mode, onlineAt))) {
          this.armWatchdog(peer, idReclaimCap, mode, onlineAt)
          return
        }
        if (idReclaimCap && forceReclaimExpired(this.reclaimStartedAt, retryNow, this.reclaimMinMs)) return
        this.runForce(peer, idReclaimCap, mode, onlineAt, 'retry')
      }, delay)
    }, watchdogMs)
  }
}
