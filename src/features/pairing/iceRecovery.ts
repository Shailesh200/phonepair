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

export function shouldRestartIce(
  state: RTCIceConnectionState,
  disconnectedSince: number | null,
  now: number,
  disconnectMs = ICE_DISCONNECTED_RESTART_MS,
): boolean {
  if (state === 'failed') return true
  if (state === 'disconnected' && disconnectedSince != null && now - disconnectedSince >= disconnectMs) return true
  return false
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
