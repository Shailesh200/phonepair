/** Do not recycle the listen peer while a remembered phone is dialing or authenticating. */
export function shouldDeferListenForceRecycle(opts: {
  hostRememberAuthPending: boolean
  guestDialInFlight: boolean
  pendingDataConn: boolean
}): boolean {
  return opts.hostRememberAuthPending || opts.guestDialInFlight || opts.pendingDataConn
}
