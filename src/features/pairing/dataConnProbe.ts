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

/** True when this tick already sent an app {t:'ping'} as a formal liveness probe. */
export function connProbeSentOnTick(probeAt: number | null, tickNow: number): boolean {
  return probeAt != null && probeAt === tickNow
}

/** Plain keepalive ping so the remote lastSeen watchdog does not drop healthy conns. */
export function shouldSendTickConnKeepalivePing(opts: {
  connOpen: boolean
  probeSentThisTick: boolean
}): boolean {
  return opts.connOpen && !opts.probeSentThisTick
}

export type TickOpenConnTraffic = 'probe' | 'keepalive-ping' | 'none'

/** Open data conn must emit probe or keepalive each tick — never neither. */
export function planTickOpenConnTraffic(opts: {
  connOpen: boolean
  probeWouldRun: boolean
}): TickOpenConnTraffic {
  if (!opts.connOpen) return 'none'
  if (opts.probeWouldRun) return 'probe'
  return 'keepalive-ping'
}

/**
 * Post-restore window: at most one probe-fail abandon for that restore (any connGen).
 * Otherwise: at most one abandon per conn generation.
 */
export function connProbeMayAbandonAfterFail(opts: {
  restoreSignalAt: number | null
  connGen: number
  lastAbandonRestoreAt: number | null
  lastAbandonConnGen: number | null
  now: number
}): boolean {
  const inPostRestoreWindow = opts.restoreSignalAt != null
    && opts.now - opts.restoreSignalAt <= DATA_CONN_PROBE_POST_RESTORE_MS
  if (inPostRestoreWindow) {
    return !(
      opts.lastAbandonRestoreAt != null
      && opts.lastAbandonRestoreAt === opts.restoreSignalAt
    )
  }
  if (opts.lastAbandonConnGen != null && opts.lastAbandonConnGen === opts.connGen) return false
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

/** Brief grace after signalling restore before forcing a fresh data conn. */
export const POST_RESTORE_STALE_DATA_REBUILD_MS = 800
/** Host and guest restore times within this window share one stale-data rebuild. */
export const RESTORE_SIGNAL_COALESCE_MS = 2000

export const SIGNAL_RESTORE_NOTICE = 'signal:restore' as const

export function isSignalRestoreNotice(t: unknown): boolean {
  return t === SIGNAL_RESTORE_NOTICE
}

/** True for `{ t:'signal:restore' }` with optional host `at` (guest must not use `at` for timing). */
export function isValidSignalRestoreNotice(m: unknown): boolean {
  return !!m && typeof m === 'object' && (m as { t?: unknown }).t === SIGNAL_RESTORE_NOTICE
}

/** Legacy parse — validates shape only; `at` is ignored on the guest for arming. */
export function parseSignalRestoreNotice(m: unknown): number | null {
  if (!isValidSignalRestoreNotice(m)) return null
  const at = (m as { at?: unknown }).at
  return typeof at === 'number' && Number.isFinite(at) ? at : null
}

export function buildSignalRestoreNotice(at: number) {
  return { t: SIGNAL_RESTORE_NOTICE, at }
}

export function restoreSignalsCoalesce(
  a: number,
  b: number,
  windowMs = RESTORE_SIGNAL_COALESCE_MS,
): boolean {
  return Math.abs(a - b) < windowMs
}

export function shouldSendHostSignalRestoreNotice(opts: {
  role: 'host' | 'guest'
  connOpen: boolean
  sessionPaired: boolean
  connEstablishedAt: number | null
  restoreSignalAt: number
}): boolean {
  if (opts.role !== 'host' || !opts.connOpen || !opts.sessionPaired) return false
  return connEstablishedBeforeRestore(opts.connEstablishedAt, opts.restoreSignalAt)
}

/** Open data conn survived from before signalling came back — probe ping/pong can lie. */
export function connEstablishedBeforeRestore(
  connEstablishedAt: number | null,
  restoreSignalAt: number | null,
): boolean {
  if (connEstablishedAt == null || restoreSignalAt == null) return false
  return connEstablishedAt < restoreSignalAt
}

export function shouldArmPostRestoreStaleDataRebuild(opts: {
  connOpen: boolean
  restoreSignalAt: number | null
  connEstablishedAt: number | null
  armedForRestore: number | null
  now: number
}): boolean {
  if (!opts.connOpen) return false
  if (opts.restoreSignalAt == null) return false
  if (opts.now - opts.restoreSignalAt > DATA_CONN_PROBE_POST_RESTORE_MS) return false
  if (
    opts.armedForRestore != null
    && restoreSignalsCoalesce(opts.armedForRestore, opts.restoreSignalAt)
  ) {
    return false
  }
  return connEstablishedBeforeRestore(opts.connEstablishedAt, opts.restoreSignalAt)
}

/** Probe retry only when the 2s lastSeen deferral blocked us (not cap/pending). */
export function connProbeBlockedByRecentTraffic(opts: {
  connOpen: boolean
  localOffersPong: boolean
  remoteSupportsPong: boolean
  probePending: boolean
  lastSeen: number
  now: number
  recentMs?: number
  restoreSignalAt?: number | null
}): boolean {
  if (!opts.connOpen || !opts.localOffersPong || !opts.remoteSupportsPong) return false
  if (opts.probePending) return false
  const recent = opts.recentMs ?? DATA_CONN_PROBE_SKIP_RECENT_MS
  const postRestore = opts.restoreSignalAt != null
    && opts.now - opts.restoreSignalAt <= DATA_CONN_PROBE_POST_RESTORE_MS
  if (postRestore) return false
  return opts.lastSeen > 0 && opts.now - opts.lastSeen < recent
}

/** Remember / paired sessions: guest tears down a pre-cut data conn and redials. */
export function shouldGuestInitiatePostRestoreStaleDataRebuild(role: 'host' | 'guest', opts: {
  sessionPaired: boolean
  rememberGuestAuth: boolean
}): boolean {
  if (role !== 'guest') return false
  return opts.sessionPaired || opts.rememberGuestAuth
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
  if (isSignalRestoreNotice(opts.t)) return true
  return !opts.rememberGuestAuth || opts.status === 'connected'
}
