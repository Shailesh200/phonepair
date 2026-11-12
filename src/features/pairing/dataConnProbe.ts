/** App-level {t:'ping'} probe after recovery; peer must advertise caps:['pong'] in hello. */
export const DATA_CONN_PROBE_TIMEOUT_MS = 2500
export const DATA_CONN_PROBE_SKIP_RECENT_MS = 2000
export const HELLO_CAP_PONG = 'pong' as const
export const LINK_HELLO_CAPS: readonly string[] = [HELLO_CAP_PONG]

export function buildLinkHelloMessage(localDeviceName: string) {
  return { t: 'hello' as const, name: localDeviceName, caps: [...LINK_HELLO_CAPS] }
}

/** Clears stale remote pong capability when the data conn is dropped or replaced. */
export function freshRemotePongCap(): false {
  return false
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
}): boolean {
  if (!opts.connOpen) return false
  if (!opts.localOffersPong || !opts.remoteSupportsPong) return false
  if (opts.probePending) return false
  const recent = opts.recentMs ?? DATA_CONN_PROBE_SKIP_RECENT_MS
  if (opts.lastSeen > 0 && opts.now - opts.lastSeen < recent) return false
  return true
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
