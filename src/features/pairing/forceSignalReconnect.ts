export const FORCE_SIGNAL_OPEN_WATCHDOG_MS = 3000
export const FORCE_SIGNAL_RECLAIM_MIN_MS = 75_000

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

type ForceMode = 'hook' | 'tick'

export class ForceSignalRunner {
  private attempt = 0
  private watchdogId: number | null = null
  private retryId: number | null = null
  private reclaimStartedAt: number | null = null
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

  onOpen() {
    this.attempt = 0
    this.reclaimStartedAt = null
    this.clearTimers()
  }

  /**
   * Explicit triggers (half-open, online, visibility, link-lost): force even when peer.open.
   * @param idReclaimCap when true, stop after FORCE_SIGNAL_RECLAIM_MIN_MS (unavailable-id only — not used for network outage).
   */
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

  /** Routine poll: skip only when the signal peer looks healthy (open and not disconnected). */
  tick(peer: ForceSignalPeerLike, active: boolean, idReclaimCap: boolean, peerHealthy: boolean) {
    if (this.stopped || !active || peer.destroyed) return
    if (peer.open && peerHealthy) {
      this.onOpen()
      return
    }
    const now = this.timers.now()
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
    this.watchdogId = this.timers.setTimeout(() => {
      this.watchdogId = null
      if (peer.destroyed || this.stopped) return
      if (mode === 'tick' && peer.open) return
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
        if (mode === 'tick' && peer.open) return
        if (idReclaimCap && forceReclaimExpired(this.reclaimStartedAt, this.timers.now(), this.reclaimMinMs)) return
        this.runForce(peer, idReclaimCap, mode)
      }, delay)
    }, FORCE_SIGNAL_OPEN_WATCHDOG_MS)
  }
}
