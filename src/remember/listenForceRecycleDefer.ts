import { REMEMBER_PROOF_TIMEOUT_MS } from './gate.ts'

/** Pending auth with no timer must not block reclaim forever. */
export const REMEMBER_FORCE_DEFER_AUTH_STALE_MS = REMEMBER_PROOF_TIMEOUT_MS + 500

function hostAuthPendingDefersRecycle(
  pending: boolean,
  pendingStartedAt: number | null,
  now: number,
): boolean {
  if (!pending) return false
  if (pendingStartedAt == null) return false
  return now - pendingStartedAt <= REMEMBER_FORCE_DEFER_AUTH_STALE_MS
}

/** Do not recycle the listen peer while a remembered phone is dialing or authenticating. */
export function shouldDeferListenForceRecycle(opts: {
  hostRememberAuthPending: boolean
  hostAuthPendingStartedAt: number | null
  guestDialInFlight: boolean
  pendingDataConn: boolean
  now?: number
}): boolean {
  const now = opts.now ?? Date.now()
  return hostAuthPendingDefersRecycle(
    opts.hostRememberAuthPending,
    opts.hostAuthPendingStartedAt,
    now,
  ) || opts.guestDialInFlight || opts.pendingDataConn
}
