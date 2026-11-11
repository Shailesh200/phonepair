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
