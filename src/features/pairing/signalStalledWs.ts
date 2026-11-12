import { WS_CONNECTING, type ForceSignalPeerStateExt } from './forceSignalPeerState.ts'

export const STALLED_SIGNAL_CONNECTING_AFTER_DROP_MS = 3000

/** Kill CONNECTING sockets left over from before a signaling drop (~3s). */
export function shouldKillStalledConnectingSocket(
  peer: ForceSignalPeerStateExt,
  now: number,
  minMs = STALLED_SIGNAL_CONNECTING_AFTER_DROP_MS,
  restoreAt: number | null = null,
): boolean {
  if (peer.destroyed) return false
  const rs = peer.signalReadyState?.() ?? null
  if (rs !== WS_CONNECTING) return false
  const started = peer.signalConnectStartedAt?.() ?? null
  if (started == null) return false
  if (restoreAt != null && started >= restoreAt) return false
  if (restoreAt != null && started < restoreAt && now >= restoreAt) return true
  const dropAt = peer.signalLastDropAt?.() ?? null
  if (dropAt == null) return false
  if (dropAt < started) return false
  return now - dropAt >= minMs
}
