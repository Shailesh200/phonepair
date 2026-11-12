import { shouldAbandonOpenDataConn, type AbandonOpenDataConnInput } from '../features/pairing/iceRecovery.ts'
import { FORCE_SOCKET_MIN_OPEN_MS } from '../features/pairing/forceSignalPeerState.ts'
import { LISTEN_RECOVERY_ID_BACKOFF_MS } from './listenIdRecovery.ts'

export function shouldClearStaleRememberMainConnForRecovery(
  role: 'host' | 'guest',
  hasRememberPhones: boolean,
  connOpen: boolean,
  abandonInput: Omit<AbandonOpenDataConnInput, 'dataConnOpen'> | null,
): boolean {
  if (role !== 'host' || !hasRememberPhones || !connOpen || !abandonInput) return false
  return shouldAbandonOpenDataConn({ ...abandonInput, dataConnOpen: true })
}

/**
 * During listen-id recovery, only trust `open` when server OPEN is after the signaling drop.
 * A half-open ghost socket keeps `open` with an older OPEN time and must be recycled.
 */
export function listenReclaimRecycleSkipsOpenSocket(
  listenOpen: boolean,
  listenDisconnected: boolean,
  recoveryDropAt: number | null,
  serverOpenAt: number | null,
): boolean {
  if (!listenOpen || listenDisconnected) return false
  if (recoveryDropAt == null) return true
  if (serverOpenAt == null) return false
  return serverOpenAt > recoveryDropAt
}

/** Fresh listen peer still handshaking after recovery — give it up to 8s before reclaim recycle. */
export function listenReclaimRecycleSkipsConnectingPeer(
  recoveryDropAt: number | null,
  connectStartedAt: number | null,
  peerOpen: boolean,
  now: number,
  minOpenMs = FORCE_SOCKET_MIN_OPEN_MS,
): boolean {
  if (recoveryDropAt == null || peerOpen) return false
  if (connectStartedAt == null || connectStartedAt <= recoveryDropAt) return false
  return now - connectStartedAt < minOpenMs
}

export function shouldListenReclaimRecyclePeer(opts: {
  deferRecycle: boolean
  listenOpen: boolean
  listenDisconnected: boolean
  recoveryDropAt: number | null
  serverOpenAt: number | null
  connectStartedAt: number | null
  now: number
}): boolean {
  if (opts.deferRecycle) return false
  if (opts.listenOpen
    && listenReclaimRecycleSkipsOpenSocket(
      opts.listenOpen,
      opts.listenDisconnected,
      opts.recoveryDropAt,
      opts.serverOpenAt,
    )) {
    return false
  }
  if (listenReclaimRecycleSkipsConnectingPeer(
    opts.recoveryDropAt,
    opts.connectStartedAt,
    opts.listenOpen,
    opts.now,
  )) {
    return false
  }
  return true
}

export function listenRecoveryReclaimIntervalMs(): number {
  return LISTEN_RECOVERY_ID_BACKOFF_MS
}

/** Reclaim polling stops when recovery mode is off and the 120s window has ended. */
export function listenRecoveryReclaimSchedulingActive(
  recoveryMode: boolean,
  reclaimUntil: number | null,
  now: number,
): boolean {
  if (recoveryMode) return true
  return reclaimUntil != null && now < reclaimUntil
}

/** Stale half-open during recovery: recycle now, next reclaim check within ~3s. */
export function listenRecoveryStaleOpenNeedsImmediateRecycle(
  listenOpen: boolean,
  recoveryDropAt: number | null,
  serverOpenAt: number | null,
): boolean {
  if (!listenOpen || recoveryDropAt == null) return false
  return !listenReclaimRecycleSkipsOpenSocket(true, false, recoveryDropAt, serverOpenAt)
}

export function listenForceTickBlockedByRecoveryMode(listenRecoveryMode: boolean): boolean {
  return listenRecoveryMode
}

/** After recovery settle, listen forcing may run again (silent open sockets, cadence/tick). */
/** `lost()` on the host must not arm listen-id recovery — only signal-peer drops do. */
export function shouldBeginListenIdRecoveryOnDataConnClose(): boolean {
  return false
}

export function listenForceResumesAfterRecoverySettle(
  listenRecoveryMode: boolean,
  now: number,
  clearRecoveryModeAt: number | null,
  settleUntil: number | null,
): boolean {
  if (listenRecoveryMode) {
    if (clearRecoveryModeAt == null) return false
    if (now < clearRecoveryModeAt) return false
  }
  if (settleUntil != null && now < settleUntil) return false
  return true
}
