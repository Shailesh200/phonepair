import type { ForceSignalPeerLike } from './forceSignalReconnect.ts'
import { FORCE_SIGNAL_CONNECTING_GRACE_MS } from './forceSignalReconnect.ts'

export const WS_CONNECTING = 0
export const WS_OPEN = 1
export const WS_CLOSING = 2
export const WS_CLOSED = 3

export type ForceSignalPeerStateExt = ForceSignalPeerLike & {
  signalReadyState?: () => number | null
  signalConnectStartedAt?: () => number | null
}

export function peerSignalConnectingAgeMs(peer: ForceSignalPeerStateExt, now: number): number | null {
  const rs = peer.signalReadyState?.() ?? null
  if (rs !== WS_CONNECTING) return null
  const started = peer.signalConnectStartedAt?.() ?? null
  if (started == null) return 0
  return now - started
}

export function mayForceReplaceSignalSocket(peer: ForceSignalPeerStateExt, now: number): boolean {
  if (peer.destroyed) return false
  const rs = peer.signalReadyState?.() ?? null
  if (rs == null) return true
  if (rs !== WS_CONNECTING) return true
  const age = peerSignalConnectingAgeMs(peer, now)
  if (age == null) return true
  return age >= FORCE_SIGNAL_CONNECTING_GRACE_MS
}

export function forceSignalWatchdogDelayMs(
  peer: ForceSignalPeerStateExt,
  now: number,
  baseWatchdogMs: number,
): number {
  if (peer.open) return baseWatchdogMs
  const age = peerSignalConnectingAgeMs(peer, now)
  if (age == null) return baseWatchdogMs
  if (age >= FORCE_SIGNAL_CONNECTING_GRACE_MS) return baseWatchdogMs
  return Math.max(baseWatchdogMs, FORCE_SIGNAL_CONNECTING_GRACE_MS - age)
}
