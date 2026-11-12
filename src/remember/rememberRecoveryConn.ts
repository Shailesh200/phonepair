import { shouldAbandonOpenDataConn, type AbandonOpenDataConnInput } from '../features/pairing/iceRecovery.ts'

export function shouldClearStaleRememberMainConnForRecovery(
  role: 'host' | 'guest',
  hasRememberPhones: boolean,
  connOpen: boolean,
  abandonInput: Omit<AbandonOpenDataConnInput, 'dataConnOpen'> | null,
): boolean {
  if (role !== 'host' || !hasRememberPhones || !connOpen || !abandonInput) return false
  return shouldAbandonOpenDataConn({ ...abandonInput, dataConnOpen: true })
}

export function listenReclaimRecycleSkipsOpenSocket(listenOpen: boolean, listenDisconnected: boolean): boolean {
  return listenOpen && !listenDisconnected
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
