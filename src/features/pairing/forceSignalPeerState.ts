import type { ForceSignalPeerLike } from './forceSignalReconnect.ts'
import {
  FORCE_SIGNAL_CONNECTING_GRACE_UNVERIFIED_MS,
  forceSignalConnectingGraceMs,
} from './forceSignalReconnect.ts'

export const WS_CONNECTING = 0
export const WS_OPEN = 1
export const WS_CLOSING = 2
export const WS_CLOSED = 3

export type ForceSignalPeerStateExt = ForceSignalPeerLike & {
  signalReadyState?: () => number | null
  signalConnectStartedAt?: () => number | null
}

export type ForceSocketReplaceOpts = {
  unverifiedAfterDrop?: boolean
  mode?: 'hook' | 'tick' | 'cadence' | 'online'
  onlineAt?: number
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
  if (
    opts?.mode === 'online'
    && opts.onlineAt != null
    && started != null
    && started < opts.onlineAt
  ) {
    return true
  }
  const age = peerSignalConnectingAgeMs(peer, now)
  if (age == null) return true
  const grace = forceSignalConnectingGraceMs(!!opts?.unverifiedAfterDrop)
  return age >= grace
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
  return delay
}
