/** Listen-id recovery and reclaim polling are only for the tab that owned the listen id. */
export function shouldHostArmListenIdRecovery(opts: {
  hasRememberPhones: boolean
  listenOwnedBefore: boolean
  listenGaveUp: boolean
}): boolean {
  return opts.hasRememberPhones && opts.listenOwnedBefore && !opts.listenGaveUp
}

/** After this long with navigator.onLine false, ignore the offline gate (stuck onLine). */
export const HOST_NAVIGATOR_OFFLINE_GATE_MS = 18_000

/** Min spacing for listen bootstrap while bypassing a stuck offline gate. */
export const HOST_STUCK_OFFLINE_BOOTSTRAP_PACE_MS = 10_000

export function hostNavigatorOfflineTooLong(
  navigatorOnLine: boolean,
  offlineSince: number | null,
  now: number,
  capMs = HOST_NAVIGATOR_OFFLINE_GATE_MS,
): boolean {
  if (navigatorOnLine) return false
  if (offlineSince == null) return false
  return now - offlineSince >= capMs
}

export function shouldDeferListenBootstrapWhileOffline(
  navigatorOnLine: boolean,
  offlineSince: number | null,
  now: number,
): boolean {
  if (navigatorOnLine) return false
  if (hostNavigatorOfflineTooLong(navigatorOnLine, offlineSince, now)) return false
  return true
}

/** Host listen/code force ticks and bootstraps while another tab has the listen id. */
export function shouldHostRememberSignalWork(
  navigatorOnLine: boolean,
  listenGaveUp: boolean,
  offlineSince: number | null,
  now: number,
): boolean {
  if (listenGaveUp) return false
  if (navigatorOnLine) return true
  return hostNavigatorOfflineTooLong(navigatorOnLine, offlineSince, now)
}

export function hostStuckOfflineBootstrapDue(
  lastStuckOfflineBootstrapAt: number | null,
  now: number,
  paceMs = HOST_STUCK_OFFLINE_BOOTSTRAP_PACE_MS,
): boolean {
  if (lastStuckOfflineBootstrapAt == null) return true
  return now - lastStuckOfflineBootstrapAt >= paceMs
}
