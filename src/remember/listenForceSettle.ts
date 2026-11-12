import { FORCE_SOCKET_MIN_OPEN_MS } from '../features/pairing/forceSignalPeerState.ts'

export const FORCE_LISTEN_SETTLE_MS = FORCE_SOCKET_MIN_OPEN_MS

export function listenForceRecycleDeferred(
  listenOpen: boolean,
  listenDisconnected: boolean,
  settleUntil: number | null,
  now: number,
): boolean {
  if (!listenOpen || listenDisconnected) return false
  if (settleUntil == null) return false
  return now < settleUntil
}
