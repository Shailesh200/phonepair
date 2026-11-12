export function canPromoteDataConn(opts: {
  fromGuestAuthPending: boolean
  fromRememberListen: boolean
  conn: unknown
  inFlightDial: unknown
  pending: unknown
  liveConn: unknown
}): boolean {
  if (opts.fromGuestAuthPending || opts.fromRememberListen) return true
  const c = opts.conn
  return c === opts.inFlightDial || c === opts.pending || c === opts.liveConn
}
