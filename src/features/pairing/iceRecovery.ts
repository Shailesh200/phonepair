export type LinkRole = 'host' | 'guest'

export const ICE_DISCONNECTED_RESTART_MS = 3000
export const ICE_RESTART_RECOVERY_MS = 10_000
export const ICE_RESTART_MIN_GAP_MS = 2000

export function isDataConnIceOfferer(role: LinkRole): boolean {
  return role === 'guest'
}

export function iceTransportRecovered(state: RTCIceConnectionState): boolean {
  return state === 'connected' || state === 'completed'
}

/** PeerJS 1.5.4 does not renegotiate on restartIce; redial is the real recovery path. */
export function shouldRedialImmediatelyOnIceFailed(state: RTCIceConnectionState): boolean {
  return state === 'failed'
}

export function shouldActOnIceNetworkChange(state: RTCIceConnectionState): boolean {
  return !iceTransportRecovered(state)
}

export function shouldRestartIce(
  state: RTCIceConnectionState,
  disconnectedSince: number | null,
  now: number,
  disconnectMs = ICE_DISCONNECTED_RESTART_MS,
): boolean {
  if (state === 'disconnected' && disconnectedSince != null && now - disconnectedSince >= disconnectMs) return true
  return false
}

export function canGuestIceRedial(hasInFlightDial: boolean, dialWait: boolean, destroyed: boolean): boolean {
  if (destroyed || hasInFlightDial || dialWait) return false
  return true
}

export function shouldRedialAfterIceRestart(
  restartAt: number,
  state: RTCIceConnectionState,
  now: number,
  recoveryMs = ICE_RESTART_RECOVERY_MS,
): boolean {
  if (!restartAt) return false
  if (now - restartAt < recoveryMs) return false
  return !iceTransportRecovered(state)
}

export function canAttemptIceRestart(inFlight: boolean, lastRestartAt: number, now: number, minGapMs = ICE_RESTART_MIN_GAP_MS): boolean {
  if (inFlight) return false
  if (!lastRestartAt) return true
  return now - lastRestartAt >= minGapMs
}
