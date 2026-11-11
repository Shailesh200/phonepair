export const GUEST_REDIAL_MAX_MS_EVER_CONNECTED = 3_000
export const GUEST_REDIAL_MAX_MS_FIRST_PAIR = 14_000
export const GUEST_UNAVAILABLE_RETRY_MIN_MS = 5 * 60_000
export const GUEST_FIRST_PAIR_UNAVAILABLE_MAX = 6

export function redialDelayMs(attempt: number, everConnected: boolean): number {
  if (attempt === 0) return 0
  if (!everConnected && attempt <= 1) return 0
  const base = everConnected ? 800 : 1500
  const cap = everConnected ? GUEST_REDIAL_MAX_MS_EVER_CONNECTED : GUEST_REDIAL_MAX_MS_FIRST_PAIR
  return Math.min(Math.round(base * Math.pow(1.55, attempt)), cap)
}

/**
 * After `peer.on('open')` or browser `online`, guest backoff is cleared and the next dial is immediate.
 */
export function guestRedialPlanAfterSignalRecovery(everConnected: boolean): {
  retry: number
  delayMs: number
} {
  return { retry: 0, delayMs: redialDelayMs(0, everConnected) }
}

/** PeerJS `peer-unavailable` before first hello — count cap. After pairing, retry at least 5 minutes. */
export function guestUnavailableShouldGiveUp(
  everConnected: boolean,
  attempt: number,
  unavailableSince: number | null,
  now: number,
): boolean {
  if (!everConnected) return attempt > GUEST_FIRST_PAIR_UNAVAILABLE_MAX
  if (unavailableSince == null) return false
  return now - unavailableSince >= GUEST_UNAVAILABLE_RETRY_MIN_MS
}

/** @deprecated Use guestUnavailableShouldGiveUp — kept for older tests referencing counts. */
export function guestUnavailableRetries(everConnected: boolean): number {
  return everConnected ? Number.POSITIVE_INFINITY : GUEST_FIRST_PAIR_UNAVAILABLE_MAX
}
