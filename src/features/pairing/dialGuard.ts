export type DialPeerSnapshot = {
  hasPeer: boolean
  destroyed: boolean
  disconnected: boolean
}

/** Guest dial attempted while the signal socket is down — wait for `open`, do not leave UI stuck. */
export function shouldDeferDialUntilPeerOpen(peer: DialPeerSnapshot): boolean {
  return peer.hasPeer && !peer.destroyed && peer.disconnected
}

export function guestShouldRedialOnPeerOpen(
  role: 'host' | 'guest',
  status: string,
  connOpen: boolean,
): boolean {
  return role === 'guest' && !connOpen && (status === 'connecting' || status === 'reconnecting' || status === 'starting')
}

export const GUEST_CONNECTING_WATCHDOG_MS = 15_000

/** `armDialWhenPeerOpens` only disarms; the main `peer.on('open')` handler dials once. */
export function reopenListenerShouldDial(): boolean {
  return false
}
