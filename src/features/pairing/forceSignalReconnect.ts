export const FORCE_SIGNAL_OPEN_WATCHDOG_MS = 3000
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
    this.unverifiedAfterDrop = false
    this.dropStartedAt = null
    this.lastCadenceAt = null
    this.attempt = 0
    this.reclaimStartedAt = null
    this.clearTimers()
  }

  onOpen() {
    this.attempt = 0
    this.reclaimStartedAt = null
    this.clearTimers()
  }

  hookOnline(peer: ForceSignalPeerLike, idReclaimCap = false) {
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

  hook(peer: ForceSignalPeerLike, idReclaimCap: boolean) {
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
    peer: ForceSignalPeerLike,
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
      if (this.dropStartedAt == null) this.onSignalingDrop()
      if (
        forceSignalCadenceDue(this.dropStartedAt, this.lastCadenceAt, now)
        && this.watchdogId == null
        && this.retryId == null
      ) {
        this.lastCadenceAt = now
        this.runForce(peer, idReclaimCap, 'cadence')
      }
      return
    }

    if (idReclaimCap) {
      this.reclaimStartedAt ??= now
      if (forceReclaimExpired(this.reclaimStartedAt, now, this.reclaimMinMs)) return
    }
    if (!signalPeerNeedsForce(peer, peerHealthy)) return
    if (this.watchdogId != null || this.retryId != null) return
    this.runForce(peer, idReclaimCap, 'tick')
  }

  private runForce(peer: ForceSignalPeerLike, idReclaimCap: boolean, mode: ForceMode) {
    if (peer.destroyed || this.stopped) return
    this.attempt += 1
    forceSignalReconnect(peer)
    if (this.watchdogId != null) {
      this.timers.clearTimeout(this.watchdogId)
      this.watchdogId = null
    }
    const trustOpen = mode === 'tick'
    this.watchdogId = this.timers.setTimeout(() => {
      this.watchdogId = null
      if (peer.destroyed || this.stopped) return
      if (trustOpen && peer.open) return
      const now = this.timers.now()
      if (idReclaimCap && forceReclaimExpired(this.reclaimStartedAt, now, this.reclaimMinMs)) return
      const delay = forceSignalReconnectBackoffMs(this.attempt)
      if (this.retryId != null) {
        this.timers.clearTimeout(this.retryId)
        this.retryId = null
      }
      this.retryId = this.timers.setTimeout(() => {
        this.retryId = null
        if (peer.destroyed || this.stopped) return
        if (trustOpen && peer.open) return
        if (idReclaimCap && forceReclaimExpired(this.reclaimStartedAt, this.timers.now(), this.reclaimMinMs)) return
        this.runForce(peer, idReclaimCap, mode)
      }, delay)
    }, FORCE_SIGNAL_OPEN_WATCHDOG_MS)
  }
}
