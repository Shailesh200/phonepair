export type LinkRole = 'host' | 'guest'

/** Redial 13s after ICE first goes disconnected (3s unhealthy + 10s grace). */
export const ICE_DISCONNECTED_GRACE_MS = 13_000
/**
 * After a signalling restore the pre-drop data channel often stays `.open` while ICE is
 * disconnected, so the UI already says Connected. Don't wait out the full 13s before redial.
 */
export const ICE_POST_RESTORE_GRACE_MS = 1_000

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

/** True when a send cannot go on the live channel yet. */
export function shouldQueueOutbound(opts: { live: boolean; connOpen: boolean; transportDead: boolean }): boolean {
  return !opts.live || !opts.connOpen || opts.transportDead
}

/** Live clipboard only. Mover, keep-awake, and remote input are not held. */
export function isClipboardPayload(m: unknown): boolean {
  if (!m || typeof m !== 'object') return false
  const t = (m as { t?: unknown }).t
  return typeof t === 'string' && t.startsWith('clip:')
}

/**
 * While the channel cannot take a send, keep the latest clipboard item and drop anything else.
 * A newer clip replaces the one already held.
 */
export function enqueueOutbound(queue: unknown[], message: unknown): unknown[] {
  if (!isClipboardPayload(message)) return queue
  return [message]
}

/** Grace to use right now. Inside the post-restore window this is 1s, otherwise 13s. */
export function iceGraceMsAfterRestore(opts: {
  now: number
  restoreSignalAt: number | null
  postRestoreWindowMs?: number
}): number {
  const windowMs = opts.postRestoreWindowMs ?? 30_000
  if (opts.restoreSignalAt != null && opts.now - opts.restoreSignalAt >= 0 && opts.now - opts.restoreSignalAt <= windowMs) {
    return ICE_POST_RESTORE_GRACE_MS
  }
  return ICE_DISCONNECTED_GRACE_MS
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
