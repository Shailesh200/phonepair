export type LinkRole = 'host' | 'guest'

export const HOST_HIDDEN_RECONNECT_MS = 30_000
export const FORCED_HOST_SIGNAL_RECONNECT_MIN_MS = 5000
export const HOST_FORCE_SIGNAL_TIMEOUT_MS = 10_000

export function shouldExpireHostForceSignalInFlight(
  forceInFlight: boolean,
  forceStartedAt: number,
  now: number,
  timeoutMs = HOST_FORCE_SIGNAL_TIMEOUT_MS,
): boolean {
  if (!forceInFlight || forceStartedAt <= 0) return false
  return now - forceStartedAt >= timeoutMs
}

export function shouldClearHostForceSignalOnPeerError(forceInFlight: boolean, samePeer: boolean): boolean {
  return forceInFlight && samePeer
}

export type HostSignalReconnectPlan = 'skip' | 'reconnect' | 'disconnect-then-reconnect'

export function planHostSignalReconnect(opts: {
  role: LinkRole
  linkDestroyed: boolean
  peerDestroyed: boolean
  peerDisconnected: boolean
  forceInFlight: boolean
  lastForcedAt: number
  now: number
  minGapMs?: number
}): HostSignalReconnectPlan {
  const gap = opts.minGapMs ?? FORCED_HOST_SIGNAL_RECONNECT_MIN_MS
  if (opts.role !== 'host' || opts.linkDestroyed || opts.peerDestroyed) return 'skip'
  if (opts.forceInFlight) return 'skip'
  if (opts.lastForcedAt > 0 && opts.now - opts.lastForcedAt < gap) return 'skip'
  if (opts.peerDisconnected) return 'reconnect'
  return 'disconnect-then-reconnect'
}

export function shouldSkipHostDisconnectedHandler(forceInFlight: boolean): boolean {
  return forceInFlight
}

export function hostKeepsConnectedStatusOnSignalDrop(dataConnOpen: boolean): boolean {
  return dataConnOpen
}

export function shouldHostReconnectOnOnline(role: LinkRole, linkDestroyed: boolean): boolean {
  return role === 'host' && !linkDestroyed
}

export function shouldHostReconnectAfterVisibility(hiddenMs: number, thresholdMs = HOST_HIDDEN_RECONNECT_MS): boolean {
  return hiddenMs > thresholdMs
}

export function isHalfOpenSignalConn(peerOpen: boolean, dataConnOpen: boolean): boolean {
  return peerOpen && !dataConnOpen
}

export function shouldHostReconnectHalfOpen(
  role: LinkRole,
  linkDestroyed: boolean,
  peerOpen: boolean,
  dataConnOpen: boolean,
): boolean {
  return role === 'host' && !linkDestroyed && isHalfOpenSignalConn(peerOpen, dataConnOpen)
}
