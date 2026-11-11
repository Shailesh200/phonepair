export type LinkRole = 'host' | 'guest'

/** Redial 13s after ICE first goes disconnected (3s unhealthy + 10s grace). */
export const ICE_DISCONNECTED_GRACE_MS = 13_000

export function isDataConnIceOfferer(role: LinkRole): boolean {
  return role === 'guest'
}

export function iceTransportRecovered(state: RTCIceConnectionState): boolean {
  return state === 'connected' || state === 'completed'
}

/** PeerJS 1.5.4 cannot renegotiate; full guest redial is the recovery path. */
export function shouldRedialImmediatelyOnIceFailed(state: RTCIceConnectionState): boolean {
  return state === 'failed'
}

export function shouldActOnIceNetworkChange(state: RTCIceConnectionState): boolean {
  return !iceTransportRecovered(state)
}

export function iceGraceFireAt(disconnectedSince: number, graceMs = ICE_DISCONNECTED_GRACE_MS): number {
  return disconnectedSince + graceMs
}

export function iceDisconnectedRedialDelayMs(disconnectedSince: number, now: number, graceMs = ICE_DISCONNECTED_GRACE_MS): number {
  const remaining = iceGraceFireAt(disconnectedSince, graceMs) - now
  return remaining > 0 ? remaining : 0
}

export function shouldRedialAfterDisconnectedGrace(
  disconnectedSince: number,
  state: RTCIceConnectionState,
  now: number,
  graceMs = ICE_DISCONNECTED_GRACE_MS,
): boolean {
  if (iceTransportRecovered(state)) return false
  if (disconnectedSince <= 0) return false
  return now - disconnectedSince >= graceMs
}

export function canGuestIceRedial(hasInFlightDial: boolean, dialWait: boolean, destroyed: boolean): boolean {
  if (destroyed || hasInFlightDial || dialWait) return false
  return true
}

/** After a real signal outage, an open DataConnection often keeps a dead RTCPeerConnection — replace it. */
export function shouldAbandonDataConnOnSignalDrop(everConnected: boolean, dataConnOpen: boolean): boolean {
  return everConnected && dataConnOpen
}

export function shouldArmIceGraceTimer(graceTimerActive: boolean, disconnectedSince: number | null): boolean {
  if (graceTimerActive || disconnectedSince == null) return false
  return true
}
