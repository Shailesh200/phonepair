import type { ForceSignalPeerLike } from './forceSignalReconnect.ts'
import {
  FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS,
  capSignalSocketRetryMs,
  forceSignalConnectingGraceMs,
} from './forceSignalReconnect.ts'

/** Do not recycle an open signaling socket younger than this unless cadence (silent open). */
export const FORCE_SOCKET_MIN_OPEN_MS = 8000

export const WS_CONNECTING = 0
export const WS_OPEN = 1
export const WS_CLOSING = 2
export const WS_CLOSED = 3

export type ForceSignalPeerStateExt = ForceSignalPeerLike & {
  signalReadyState?: () => number | null
  signalConnectStartedAt?: () => number | null
  signalPeerOpenAt?: () => number | null
  signalLastDropAt?: () => number | null
}

export type ForceSocketReplaceOpts = {
  unverifiedAfterDrop?: boolean
  mode?: 'hook' | 'tick' | 'cadence' | 'online'
  onlineAt?: number
  /** Restore evidence (online, visibility, recovery tick): sockets from before this time may recycle. */
  restoreSignalAt?: number | null
}

export function peerSignalConnectingAgeMs(peer: ForceSignalPeerStateExt, now: number): number | null {
  const rs = peer.signalReadyState?.() ?? null
  if (rs !== WS_CONNECTING) return null
  const started = peer.signalConnectStartedAt?.() ?? null
  if (started == null) return 0
  return now - started
}

export function mayForceReplaceSignalSocket(
  peer: ForceSignalPeerStateExt,
  now: number,
  opts?: ForceSocketReplaceOpts,
): boolean {
  if (peer.destroyed) return false
  const rs = peer.signalReadyState?.() ?? null
  if (rs == null) return true
  if (rs !== WS_CONNECTING) return true
  const started = peer.signalConnectStartedAt?.() ?? null
  const restoreAt = opts?.restoreSignalAt ?? opts?.onlineAt ?? null
  if (restoreAt != null && started != null && started < restoreAt) {
    return true
  }
  const age = peerSignalConnectingAgeMs(peer, now)
  if (age == null) return true
  const grace = forceSignalConnectingGraceMs(!!opts?.unverifiedAfterDrop)
  return age >= grace
}

export function mayForceRecycleOpenSignalSocket(
  peer: ForceSignalPeerStateExt,
  now: number,
  opts?: ForceSocketReplaceOpts,
): boolean {
  if (!mayForceReplaceSignalSocket(peer, now, opts)) return false
  if (!peer.open) return true
  const openedAt = peer.signalPeerOpenAt?.() ?? null
  if (openedAt == null) return true
  if (now - openedAt < FORCE_SOCKET_MIN_OPEN_MS) {
    const restoreAt = opts?.restoreSignalAt ?? opts?.onlineAt ?? null
    if (restoreAt != null && openedAt < restoreAt) return true
    return opts?.mode === 'cadence'
  }
  return true
}

export function forceSignalWatchdogDelayMs(
  peer: ForceSignalPeerStateExt,
  now: number,
  baseWatchdogMs: number,
  unverifiedAfterDrop: boolean,
): number {
  if (peer.open) return baseWatchdogMs
  const grace = forceSignalConnectingGraceMs(unverifiedAfterDrop)
  const age = peerSignalConnectingAgeMs(peer, now)
  if (age == null) return baseWatchdogMs
  let delay = baseWatchdogMs
  if (age < grace) delay = Math.max(baseWatchdogMs, grace - age)
  if (unverifiedAfterDrop) {
    delay = Math.min(FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS, delay)
  }
  return capSignalSocketRetryMs(delay)
}
