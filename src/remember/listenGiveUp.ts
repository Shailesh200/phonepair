/** After listen peer hits unavailable-id give-up, tick must not re-bootstrap until cleared. */
export function shouldTickBootstrapListen(opts: {
  hasPhones: boolean
  listenMissing: boolean
  listenGaveUp: boolean
  bootstrapInFlight: boolean
  backoffUntil: number
  now: number
}): boolean {
  const { hasPhones, listenMissing, listenGaveUp, bootstrapInFlight, backoffUntil, now } = opts
  if (listenGaveUp || bootstrapInFlight) return false
  if (now < backoffUntil) return false
  return hasPhones && listenMissing
}
