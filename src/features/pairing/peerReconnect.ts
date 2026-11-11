export const PEER_RECONNECT_MIN_MS = 3000

export type PeerReconnectSnapshot = {
  role: 'host' | 'guest'
  disconnected: boolean
  peerDestroyed: boolean
  linkDestroyed: boolean
  lastPeerReconnectAt: number
  now?: number
}

export function shouldCallPeerReconnect(s: PeerReconnectSnapshot): boolean {
  if (s.role !== 'guest') return false
  if (s.linkDestroyed || s.peerDestroyed) return false
  if (!s.disconnected) return false
  const now = s.now ?? Date.now()
  if (s.lastPeerReconnectAt === 0) return true
  return now - s.lastPeerReconnectAt >= PEER_RECONNECT_MIN_MS
}

export type HostReconnectSnapshot = {
  role: 'host' | 'guest'
  linkDestroyed: boolean
  samePeer: boolean
  disconnected: boolean
  peerDestroyed: boolean
}

/** Host signalling reconnect after a blip. Guests use shouldCallPeerReconnect instead. */
export function shouldHostReconnect(s: HostReconnectSnapshot): boolean {
  return s.role === 'host' && !s.linkDestroyed && s.samePeer && s.disconnected && !s.peerDestroyed
}
