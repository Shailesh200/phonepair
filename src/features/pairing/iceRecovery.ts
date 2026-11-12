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

/** Matches link tick: stale session when no payload/ping for this long. */
export const DATA_CONN_LAST_SEEN_TIMEOUT_MS = 15_000

export type AbandonOpenDataConnInput = {
  everConnected: boolean
  dataConnOpen: boolean
  iceState: RTCIceConnectionState | null
  connectionState?: RTCPeerConnectionState | null
  lastSeen: number
  now: number
  lastSeenTimeoutMs?: number
  iceDisconnectedSince?: number | null
  /** Failed app-level probe with pong-capable peer — abandon inside ICE grace. */
  probeFailed?: boolean
}

/** Only drop an open data channel when ICE is dead or the session is stale — not on signal `disconnected` alone. */
export function shouldAbandonOpenDataConn(opts: AbandonOpenDataConnInput): boolean {
  if (!opts.everConnected || !opts.dataConnOpen) return false
  if (opts.probeFailed) return true
  const conn = opts.connectionState
  if (conn === 'disconnected' || conn === 'failed' || conn === 'closed') return true
  const ice = opts.iceState
  if (ice === 'disconnected') {
    const since = opts.iceDisconnectedSince
    if (since != null && since > 0 && opts.now - since < ICE_DISCONNECTED_GRACE_MS) return false
    return true
  }
  if (ice === 'failed' || ice === 'closed') return true
  const timeout = opts.lastSeenTimeoutMs ?? DATA_CONN_LAST_SEEN_TIMEOUT_MS
  if (opts.lastSeen > 0 && opts.now - opts.lastSeen >= timeout) return true
  return false
}

/** @deprecated Use shouldAbandonOpenDataConn */
export function shouldAbandonDataConnOnSignalDrop(everConnected: boolean, dataConnOpen: boolean): boolean {
  return everConnected && dataConnOpen
}

export function shouldArmIceGraceTimer(graceTimerActive: boolean, disconnectedSince: number | null): boolean {
  if (graceTimerActive || disconnectedSince == null) return false
  return true
}
