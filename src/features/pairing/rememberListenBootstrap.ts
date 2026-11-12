import type Peer from 'peerjs'

/** Whether bootstrap should create a new Peer, reconnect the existing one, or skip. */
export type ListenBootstrapPeerPlan = 'skip-open' | 'reconnect-existing' | 'create-new'

export function planListenBootstrapPeer(
  prev: Pick<Peer, 'destroyed' | 'open' | 'disconnected'> | null,
): ListenBootstrapPeerPlan {
  if (!prev || prev.destroyed) return 'create-new'
  if (prev.open && !prev.disconnected) return 'skip-open'
  return 'reconnect-existing'
}
