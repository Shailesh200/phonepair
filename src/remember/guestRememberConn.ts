/** Guest remember: allow auth on a new conn while the live session stays up until promote. */
export function guestRememberIncomingAuthAction(
  liveConnOpen: boolean,
  hasAuthPending: boolean,
): 'reject-incoming' | 'begin-auth' {
  if (hasAuthPending) return 'reject-incoming'
  return 'begin-auth'
}

/** Close the live conn only when mutual auth on the new conn succeeded. */
export function guestRememberSwapOnPromote(
  liveConnOpen: boolean,
  liveIsPromoteTarget: boolean,
  fromGuestAuth: boolean,
): 'swap' | 'reject-new' | 'noop' {
  if (!liveConnOpen || liveIsPromoteTarget) return 'noop'
  if (fromGuestAuth) return 'swap'
  return 'reject-new'
}

/** Failed/timed-out auth must not tear down the existing live conn. */
export function guestRememberKeepLiveOnAuthFail(failingConnIsAuthPending: boolean): boolean {
  return failingConnIsAuthPending
}
