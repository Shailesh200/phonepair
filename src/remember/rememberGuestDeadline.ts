export const REMEMBER_GUEST_HOME_MS = 8_000

export function rememberGuestDeadlineArm(existingDeadlineMs: number, now: number, limitMs = REMEMBER_GUEST_HOME_MS): number {
  if (existingDeadlineMs > 0) return existingDeadlineMs
  return now + limitMs
}
