import {
  LISTEN_ID_RECLAIM_MIN_MS,
  listenBackoffForClaim as listenBackoffForClaimBase,
  listenClaimShouldGiveUp as listenClaimShouldGiveUpBase,
  listenReclaimIdBackoffMs,
  listenReclaimIdGiveUp,
} from './listenIdReclaim.ts'

/** After a hard laptop cut, keep reclaiming the listen id through server ghost registrations. */
export const LISTEN_RECOVERY_RECLAIM_MAX_MS = 120_000
export const LISTEN_RECOVERY_ID_BACKOFF_MS = 2500

export const REMEMBER_GUEST_DIAL_OPEN_MS = 5_000

export function listenRecoveryReclaimMaxMs(recoveryMode: boolean): number {
  return recoveryMode ? LISTEN_RECOVERY_RECLAIM_MAX_MS : LISTEN_ID_RECLAIM_MIN_MS
}

export function listenBackoffForClaim(
  attempt: number,
  listenOwnedBefore: boolean,
  reclaimStartedAt: number | null,
  defaultBackoffMs: (n: number) => number,
  recoveryMode: boolean,
): number {
  if (recoveryMode && listenOwnedBefore && reclaimStartedAt != null) {
    return LISTEN_RECOVERY_ID_BACKOFF_MS
  }
  return listenBackoffForClaimBase(
    attempt,
    listenOwnedBefore,
    reclaimStartedAt,
    defaultBackoffMs,
  )
}

export function listenClaimShouldGiveUp(
  unavailableFailures: number,
  socketsOpened: number,
  listenOwnedBefore: boolean,
  reclaimStartedAt: number | null,
  now: number,
  recoveryMode: boolean,
): boolean {
  if (listenOwnedBefore && reclaimStartedAt != null) {
    const cap = listenRecoveryReclaimMaxMs(recoveryMode)
    if (listenReclaimIdGiveUp(reclaimStartedAt, now, cap)) return true
    if (recoveryMode) return false
  }
  return listenClaimShouldGiveUpBase(
    unavailableFailures,
    socketsOpened,
    listenOwnedBefore,
    reclaimStartedAt,
    now,
  )
}

export { listenReclaimIdBackoffMs }
