export function shouldForceListenPeerReconnect(peerDestroyed: boolean, _peerDisconnected: boolean, peerOpen: boolean): boolean {
  if (peerDestroyed || peerOpen) return false
  return true
}
