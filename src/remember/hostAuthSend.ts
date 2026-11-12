type RememberConn = { open: boolean; peer: string }
type AuthPending = { conn: RememberConn } | null

export function shouldLinkSend(conn: RememberConn | null, authPending: AuthPending | null): boolean {
  if (!conn?.open) return false
  if (authPending && authPending.conn === conn) return false
  return true
}

export function shouldAcceptIncomingCall(conn: RememberConn | null, peerId: string | undefined): boolean {
  if (!conn?.open || !peerId) return false
  return conn.peer === peerId
}

/** Block call/send only when this specific conn is still in remember auth. */
export function connBlockedByRememberAuth(
  conn: RememberConn | null,
  guestAuthConn: RememberConn | null | undefined,
  hostAuthConn: RememberConn | null | undefined,
): boolean {
  if (!conn?.open) return true
  if (guestAuthConn && guestAuthConn === conn) return true
  if (hostAuthConn && hostAuthConn === conn) return true
  return false
}
