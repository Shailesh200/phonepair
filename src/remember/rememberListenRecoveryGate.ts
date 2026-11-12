/** Listen-id recovery and reclaim polling are only for the tab that owned the listen id. */
export function shouldHostArmListenIdRecovery(opts: {
  hasRememberPhones: boolean
  listenOwnedBefore: boolean
  listenGaveUp: boolean
}): boolean {
  return opts.hasRememberPhones && opts.listenOwnedBefore && !opts.listenGaveUp
}

export function shouldDeferListenBootstrapWhileOffline(navigatorOnLine: boolean): boolean {
  return !navigatorOnLine
}

/** Host listen/code force ticks and bootstraps while another tab has the listen id. */
export function shouldHostRememberSignalWork(
  navigatorOnLine: boolean,
  listenGaveUp: boolean,
): boolean {
  if (listenGaveUp) return false
  return navigatorOnLine
}
