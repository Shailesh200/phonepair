export type LinkRole = 'host' | 'guest'

export const HOST_HIDDEN_RECONNECT_MS = 30_000

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
