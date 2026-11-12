export type ListenRecoveryStateSnapshot = {
  listenRecoveryMode: boolean
  listenRecoveryDropAt: number | null
  listenRecoveryReclaimUntil: number | null
}

export function listenRecoveryStateIsCleared(state: ListenRecoveryStateSnapshot): boolean {
  return !state.listenRecoveryMode
    && state.listenRecoveryDropAt == null
    && state.listenRecoveryReclaimUntil == null
}
