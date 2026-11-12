/** App-level {t:'ping'} probe after recovery; peer must advertise caps:['pong'] in hello. */
export const DATA_CONN_PROBE_TIMEOUT_MS = 2500
export const DATA_CONN_PROBE_SKIP_RECENT_MS = 2000
/** After a signalling restore, always probe even if lastSeen was bumped during reconnect. */
export const DATA_CONN_PROBE_POST_RESTORE_MS = 30_000
export const HELLO_CAP_PONG = 'pong' as const
export const LINK_HELLO_CAPS: readonly string[] = [HELLO_CAP_PONG]

export function buildLinkHelloMessage(localDeviceName: string) {
  return { t: 'hello' as const, name: localDeviceName, caps: [...LINK_HELLO_CAPS] }
}

/** Clears stale in-memory remote pong flag; ledger keeps per-peer evidence across drops. */
export function freshRemotePongCap(): false {
  return false
}

export type RemotePongCapLedger = Map<string, boolean>

/** Record hello caps for this remote peer id; returns whether pong was advertised. */
export function recordRemoteHelloPongCap(
  ledger: RemotePongCapLedger,
  remotePeerId: string,
  caps: unknown,
): boolean {
  const cap = helloCapsIncludePong(caps)
  ledger.set(remotePeerId, cap)
  return cap
}

/** Probe only when a prior hello from this peer id included caps:['pong']. */
export function remotePongCapSeenForPeer(
  ledger: RemotePongCapLedger,
  remotePeerId: string | null | undefined,
): boolean {
  if (!remotePeerId) return false
  return ledger.get(remotePeerId) === true
}

export function shouldMarkConnProbeEligible(opts: {
  connOpen: boolean
  connProbeEligible: boolean
  everConnected: boolean
  sessionPaired: boolean
  rememberGuestAuth: boolean
}): boolean {
  if (!opts.connOpen) return false
  if (opts.connProbeEligible) return true
  return opts.everConnected && opts.sessionPaired
}

export function helloCapsIncludePong(caps: unknown): boolean {
  return Array.isArray(caps) && caps.includes(HELLO_CAP_PONG)
}

export function shouldRunDataConnProbe(opts: {
  connOpen: boolean
  localOffersPong: boolean
  remoteSupportsPong: boolean
  probePending: boolean
  lastSeen: number
  now: number
  recentMs?: number
  restoreSignalAt?: number | null
}): boolean {
  if (!opts.connOpen) return false
  if (!opts.localOffersPong || !opts.remoteSupportsPong) return false
  if (opts.probePending) return false
  const recent = opts.recentMs ?? DATA_CONN_PROBE_SKIP_RECENT_MS
  const postRestore = opts.restoreSignalAt != null
    && opts.now - opts.restoreSignalAt <= DATA_CONN_PROBE_POST_RESTORE_MS
  if (!postRestore && opts.lastSeen > 0 && opts.now - opts.lastSeen < recent) return false
  return true
}

export function connProbeRetryDelayMs(
  lastSeen: number,
  now: number,
  recentMs = DATA_CONN_PROBE_SKIP_RECENT_MS,
): number {
  if (lastSeen <= 0) return 0
  const wait = recentMs - (now - lastSeen)
  return wait > 0 ? wait : 0
}

/** Fresh data after probeAt (lastSeen strictly past probeAt) means the conn is alive. */
export function dataConnProbeSucceeded(lastSeen: number, probeAt: number | null): boolean {
  if (probeAt == null) return false
  return lastSeen > probeAt
}

export function isConnProbeControlType(t: unknown): boolean {
  return t === 'ping' || t === 'pong'
}

/** Conn keepalive (ping/pong, lastSeen) runs on an open data conn even while remember-guest is reconnecting. */
export function shouldDispatchConnKeepalive(opts: {
  connOpen: boolean
  rememberGuestAuth: boolean
  status: string
  t: unknown
}): boolean {
  if (!opts.connOpen) return false
  if (isConnProbeControlType(opts.t)) return true
  return !opts.rememberGuestAuth || opts.status === 'connected'
}
