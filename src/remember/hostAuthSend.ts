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
