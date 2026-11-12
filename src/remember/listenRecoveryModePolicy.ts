import { FORCE_LISTEN_SETTLE_MS } from './listenForceSettle.ts'
import { LISTEN_RECOVERY_RECLAIM_MAX_MS } from './listenIdRecovery.ts'

export function listenRecoveryModeBlocksListenForce(listenRecoveryMode: boolean): boolean {
  return listenRecoveryMode
}

export type ListenRecoveryServerOpenPlan = {
  endUnverifiedForcing: boolean
  settleUntil: number | null
  clearRecoveryModeAt: number | null
}

export function listenRecoveryReclaimUntilFromDrop(recoveryDropAt: number): number {
  return recoveryDropAt + LISTEN_RECOVERY_RECLAIM_MAX_MS
}

export function planListenRecoveryOnServerOpen(
  listenRecoveryMode: boolean,
  now: number,
  recoveryReclaimUntil: number | null,
  settleMs = FORCE_LISTEN_SETTLE_MS,
): ListenRecoveryServerOpenPlan {
  if (!listenRecoveryMode) {
    return { endUnverifiedForcing: false, settleUntil: null, clearRecoveryModeAt: null }
  }
  const settleUntil = now + settleMs
  const clearAtSettle = now + settleMs
  const clearRecoveryModeAt =
    recoveryReclaimUntil != null ? Math.min(clearAtSettle, recoveryReclaimUntil) : clearAtSettle
  return {
    endUnverifiedForcing: true,
    settleUntil,
    clearRecoveryModeAt,
  }
}

/** After listen server OPEN with no phone, force ticks resume once recovery mode is cleared post-settle. */
export function listenForceTickResumesAfterRecoverySettle(
  listenRecoveryMode: boolean,
  now: number,
  clearRecoveryModeAt: number | null,
): boolean {
  if (!listenRecoveryMode) return true
  if (clearRecoveryModeAt == null) return false
  return now >= clearRecoveryModeAt
}
