import {
  forceSignalWatchdogDelayMs,
  mayForceReplaceSignalSocket,
  type ForceSignalPeerStateExt,
} from './forceSignalPeerState.ts'

export const FORCE_SIGNAL_OPEN_WATCHDOG_MS = 3000
export const FORCE_SIGNAL_CONNECTING_GRACE_MS = 10_000
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

export class ForceSignalRunner {
  private attempt = 0
  private watchdogId: number | null = null
  private retryId: number | null = null
  private reclaimStartedAt: number | null = null
  private dropStartedAt: number | null = null
  private lastCadenceAt: number | null = null
  private unverifiedAfterDrop = false
  private stopped = false
  private timers: ForceSignalTimers
  private reclaimMinMs: number

  constructor(timers: ForceSignalTimers, reclaimMinMs = FORCE_SIGNAL_RECLAIM_MIN_MS) {
    this.timers = timers
    this.reclaimMinMs = reclaimMinMs
  }

  stop() {
    this.stopped = true
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
    this.lastCadenceAt = null
  }

  onPhoneConnected() {
    this.endUnverifiedForcing()
    this.attempt = 0
    this.reclaimStartedAt = null
  }

  endUnverifiedForcing() {
    this.unverifiedAfterDrop = false
    this.dropStartedAt = null
    this.lastCadenceAt = null
    this.clearTimers()
  }

  onOpen() {
    this.attempt = 0
    this.reclaimStartedAt = null
    this.clearTimers()
  }

  hookOnline(peer: ForceSignalPeerStateExt, idReclaimCap = false) {
    if (this.stopped || peer.destroyed) return
    if (this.watchdogId != null) return
    if (this.retryId != null) {
      this.timers.clearTimeout(this.retryId)
      this.retryId = null
    }
    this.clearTimers()
    this.attempt = 0
    this.runForce(peer, idReclaimCap, 'online')
  }

  hook(peer: ForceSignalPeerStateExt, idReclaimCap: boolean) {
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
  ) {
    if (this.stopped || !active || peer.destroyed) return
    const unverified = unverifiedMode || this.unverifiedAfterDrop
    const peerHealthy = unverified ? false : peerLooksHealthy

    if (!unverified && peer.open && peerHealthy) {
      this.onOpen()
      return
    }

    const now = this.timers.now()
    if (unverified && peer.open && !peer.disconnected) {
      if (this.dropStartedAt == null) return
      if (
        forceSignalCadenceDue(this.dropStartedAt, this.lastCadenceAt, now)
        && this.watchdogId == null
        && this.retryId == null
        && mayForceReplaceSignalSocket(peer, now)
      ) {
        this.lastCadenceAt = now
        this.runForce(peer, idReclaimCap, 'cadence')
      }
      return
    }

    if (unverified) return

    if (idReclaimCap) {
      this.reclaimStartedAt ??= now
      if (forceReclaimExpired(this.reclaimStartedAt, now, this.reclaimMinMs)) return
    }
    if (!signalPeerNeedsForce(peer, peerHealthy)) return
    if (this.watchdogId != null || this.retryId != null) return
    if (!mayForceReplaceSignalSocket(peer, now)) return
    this.runForce(peer, idReclaimCap, 'tick')
  }

  private hookRetryBackoff(attempt: number, mode: ForceMode, now: number): number {
    if (this.dropStartedAt != null && mode !== 'cadence') {
      return forceSignalDropHookBackoffMs(attempt, this.dropStartedAt, now)
    }
    return forceSignalReconnectBackoffMs(attempt)
  }

  private runForce(peer: ForceSignalPeerStateExt, idReclaimCap: boolean, mode: ForceMode) {
    if (peer.destroyed || this.stopped) return
    const now = this.timers.now()
    if (!mayForceReplaceSignalSocket(peer, now)) {
      this.armWatchdog(peer, idReclaimCap, mode)
      return
    }
    this.attempt += 1
    forceSignalReconnect(peer)
    if (mode === 'cadence') return
    this.armWatchdog(peer, idReclaimCap, mode)
  }

  private armWatchdog(peer: ForceSignalPeerStateExt, idReclaimCap: boolean, mode: ForceMode) {
    if (this.watchdogId != null) {
      this.timers.clearTimeout(this.watchdogId)
      this.watchdogId = null
    }
    const trustOpen = mode === 'tick'
    const now = this.timers.now()
    const watchdogMs = forceSignalWatchdogDelayMs(peer, now, FORCE_SIGNAL_OPEN_WATCHDOG_MS)
    this.watchdogId = this.timers.setTimeout(() => {
      this.watchdogId = null
      if (peer.destroyed || this.stopped) return
      if (trustOpen && peer.open) return
      const t = this.timers.now()
      if (!mayForceReplaceSignalSocket(peer, t)) {
        this.armWatchdog(peer, idReclaimCap, mode)
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
        if (trustOpen && peer.open) return
        const retryNow = this.timers.now()
        if (!mayForceReplaceSignalSocket(peer, retryNow)) {
          this.armWatchdog(peer, idReclaimCap, mode)
          return
        }
        if (idReclaimCap && forceReclaimExpired(this.reclaimStartedAt, retryNow, this.reclaimMinMs)) return
        this.runForce(peer, idReclaimCap, mode)
      }, delay)
    }, watchdogMs)
  }
}
