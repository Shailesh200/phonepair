export const HOST_LISTEN_FORCE_STAGGER_MS = 2000

export function hostListenStaggerUntil(now: number): number {
  return now + HOST_LISTEN_FORCE_STAGGER_MS
}

export function shouldDeferListenForce(
  codePeerOpen: boolean,
  staggerUntil: number | null,
  now: number,
  rememberPhonesListenPriority = false,
): boolean {
  if (rememberPhonesListenPriority) return false
  if (codePeerOpen) return false
  if (staggerUntil == null) return false
  return now < staggerUntil
}
