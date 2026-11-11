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

export const DIAL_OPEN_TIMEOUT_MS = 12_000
export const DIAL_OPEN_TIMEOUT_RELAY_MS = 25_000

export function dialOpenTimeoutMs(relayOnly: boolean): number {
  return relayOnly ? DIAL_OPEN_TIMEOUT_RELAY_MS : DIAL_OPEN_TIMEOUT_MS
}

/** While a guest dial is in flight, suppress spawning another DataConnection. */
export function guestDialInFlight(inFlightUntil: number, now = Date.now()): boolean {
  return inFlightUntil > now
}

/** After the connecting stall threshold, only the watchdog redials when nothing is in flight. */
export function guestWatchdogShouldRedial(dialInFlight: boolean, elapsedMs: number): boolean {
  if (elapsedMs < GUEST_CONNECTING_WATCHDOG_MS) return false
  return !dialInFlight
}
