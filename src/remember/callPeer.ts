import type Peer from 'peerjs'

/** Outbound media must use the Peer that owns the active data channel (code vs listen). */
export function peerForOutboundCall(
  connPeer: Peer | null,
  fallbackPeer: Peer | null,
): Peer | null {
  return connPeer ?? fallbackPeer
}
