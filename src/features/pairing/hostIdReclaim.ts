import { hostUnavailableIdBackoffMs, hostUnavailableIdGiveUp } from './hostClaim.ts'

export const HOST_ID_RECLAIM_MIN_MS = 75_000

/** Reclaim backoff (s): 1, 2, 4, 8, then 10s for every further attempt. */
export function hostReclaimIdBackoffMs(attempt: number): number {
  if (attempt <= 1) return 1000
  if (attempt === 2) return 2000
  if (attempt === 3) return 4000
  if (attempt === 4) return 8000
  return 10_000
}

export function hostReclaimIdGiveUp(reclaimStartedAt: number, now: number, minMs = HOST_ID_RECLAIM_MIN_MS): boolean {
  return now - reclaimStartedAt >= minMs
}

export function shouldUseHostIdReclaimWindow(everConnected: boolean, reclaimStartedAt: number | null): boolean {
  return everConnected && reclaimStartedAt != null
}

export function ensureHostReclaimStarted(
  everConnected: boolean,
  reclaimStartedAt: number | null,
  now: number,
): number | null {
  if (!everConnected) return null
  return reclaimStartedAt ?? now
}

export function hostUnavailableIdBackoffForClaim(
  attempt: number,
  reclaimStartedAt: number | null,
  everConnected: boolean,
): number {
  if (shouldUseHostIdReclaimWindow(everConnected, reclaimStartedAt)) return hostReclaimIdBackoffMs(attempt)
  return hostUnavailableIdBackoffMs(attempt)
}

export function hostUnavailableIdShouldGiveUp(
  attempt: number,
  reclaimStartedAt: number | null,
  now: number,
  everConnected: boolean,
): boolean {
  if (shouldUseHostIdReclaimWindow(everConnected, reclaimStartedAt)) {
    return hostReclaimIdGiveUp(reclaimStartedAt!, now)
  }
  return hostUnavailableIdGiveUp(attempt)
}

/** Wall-clock delay sum before attempt `n` (1-based), for tests. */
export function hostReclaimDelayBeforeAttempt(attempt: number): number {
  let total = 0
  for (let i = 1; i < attempt; i++) total += hostReclaimIdBackoffMs(i)
  return total
}
