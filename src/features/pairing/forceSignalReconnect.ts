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

export function signalPeerNeedsForce(peer: ForceSignalPeerLike): boolean {
  if (peer.destroyed || peer.open) return false
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
    this.clearTimers()
  }

  hook(peer: ForceSignalPeerLike, reclaimActive: boolean) {
    if (this.stopped || peer.destroyed) return
    const now = this.timers.now()
    if (reclaimActive) this.reclaimStartedAt ??= now
    if (reclaimActive && forceReclaimExpired(this.reclaimStartedAt, now, this.reclaimMinMs)) return
    if (peer.open) {
      this.onOpen()
      return
    }
    this.clearTimers()
    this.attempt = 0
    this.runForce(peer, reclaimActive)
  }

  tick(peer: ForceSignalPeerLike, active: boolean, reclaimActive: boolean) {
    if (this.stopped || !active || peer.destroyed) return
    if (peer.open) {
      this.onOpen()
      return
    }
    const now = this.timers.now()
    if (reclaimActive) {
      this.reclaimStartedAt ??= now
      if (forceReclaimExpired(this.reclaimStartedAt, now, this.reclaimMinMs)) return
    }
    if (!signalPeerNeedsForce(peer)) return
    if (this.watchdogId != null || this.retryId != null) return
    this.runForce(peer, reclaimActive)
  }

  private runForce(peer: ForceSignalPeerLike, reclaimActive: boolean) {
    if (peer.open || peer.destroyed || this.stopped) return
    this.attempt += 1
    forceSignalReconnect(peer)
    if (this.watchdogId != null) {
      this.timers.clearTimeout(this.watchdogId)
      this.watchdogId = null
    }
    this.watchdogId = this.timers.setTimeout(() => {
      this.watchdogId = null
      if (peer.open || peer.destroyed || this.stopped) return
      const now = this.timers.now()
      if (reclaimActive && forceReclaimExpired(this.reclaimStartedAt, now, this.reclaimMinMs)) return
      const delay = forceSignalReconnectBackoffMs(this.attempt)
      if (this.retryId != null) {
        this.timers.clearTimeout(this.retryId)
        this.retryId = null
      }
      this.retryId = this.timers.setTimeout(() => {
        this.retryId = null
        if (peer.open || peer.destroyed || this.stopped) return
        if (reclaimActive && forceReclaimExpired(this.reclaimStartedAt, this.timers.now(), this.reclaimMinMs)) return
        this.runForce(peer, reclaimActive)
      }, delay)
    }, FORCE_SIGNAL_OPEN_WATCHDOG_MS)
  }
}
