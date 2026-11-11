export const HOST_UNAVAILABLE_ID_MAX_TRIES = 8

/** Backoff after each `unavailable-id`; eight tries span ~14.5s of waiting. */
const HOST_UNAVAILABLE_ID_BACKOFF_MS = [1200, 1500, 1800, 2000, 2000, 2200, 2300, 2500]

export function hostUnavailableIdBackoffMs(attempt: number): number {
  const idx = Math.max(0, Math.min(attempt - 1, HOST_UNAVAILABLE_ID_BACKOFF_MS.length - 1))
  return HOST_UNAVAILABLE_ID_BACKOFF_MS[idx]
}

export function hostUnavailableIdGiveUp(attempt: number): boolean {
  return attempt > HOST_UNAVAILABLE_ID_MAX_TRIES
}
