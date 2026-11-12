import { capSignalSocketRetryMs } from '../features/pairing/forceSignalReconnect.ts'
import { listenClaimGiveUp, REMEMBER_LISTEN_UNAVAILABLE_GIVE_UP } from './rememberListenClaim.ts'

export const LISTEN_ID_RECLAIM_MIN_MS = 75_000

/** Reclaim backoff (s): 1, 2, 4, then 5s cap for every further attempt. */
export function listenReclaimIdBackoffMs(attempt: number): number {
  let ms = 1000
  if (attempt <= 1) ms = 1000
  else if (attempt === 2) ms = 2000
  else if (attempt === 3) ms = 4000
  else if (attempt === 4) ms = 8000
  else ms = 10_000
  return capSignalSocketRetryMs(ms)
}

export function listenReclaimIdGiveUp(reclaimStartedAt: number, now: number, minMs = LISTEN_ID_RECLAIM_MIN_MS): boolean {
  return now - reclaimStartedAt >= minMs
}

export function ensureListenReclaimStarted(
  listenOwnedBefore: boolean,
  reclaimStartedAt: number | null,
  now: number,
): number | null {
  if (!listenOwnedBefore) return null
  return reclaimStartedAt ?? now
}

export function listenClaimShouldGiveUp(
  unavailableFailures: number,
  socketsOpened: number,
  listenOwnedBefore: boolean,
  reclaimStartedAt: number | null,
  now: number,
): boolean {
  if (listenOwnedBefore && reclaimStartedAt != null) {
    return listenReclaimIdGiveUp(reclaimStartedAt, now)
  }
  return listenClaimGiveUp(unavailableFailures, socketsOpened)
}

export function listenBackoffForClaim(
  attempt: number,
  listenOwnedBefore: boolean,
  reclaimStartedAt: number | null,
  defaultBackoffMs: (n: number) => number,
): number {
  if (listenOwnedBefore && reclaimStartedAt != null) return listenReclaimIdBackoffMs(attempt)
  return defaultBackoffMs(attempt)
}

export function shouldRearmListenPeer(opts: {
  role: 'host' | 'guest'
  hasPhones: boolean
  status: string
  listenMissingOrDead: boolean
}): boolean {
  if (opts.role !== 'host' || !opts.hasPhones) return false
  if (opts.listenMissingOrDead) return true
  if (opts.status === 'waiting' || opts.status === 'reconnecting') return true
  return false
}

export { REMEMBER_LISTEN_UNAVAILABLE_GIVE_UP }
