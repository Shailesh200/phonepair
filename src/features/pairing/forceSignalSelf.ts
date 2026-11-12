/** Peer we are about to disconnect() inside a force runner — ignore the next `disconnected` event. */
const pendingForceDisconnect = new WeakMap<object, boolean>()

export function markPeerForceDisconnect(peer: object): void {
  pendingForceDisconnect.set(peer, true)
}

export function takePeerForceDisconnect(peer: object): boolean {
  if (!pendingForceDisconnect.get(peer)) return false
  pendingForceDisconnect.delete(peer)
  return true
}
