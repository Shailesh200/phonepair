import type { AuthPending, RememberConn } from './hostAuth.ts'

export function authConnStillPending(
  authPending: AuthPending | null,
  conn: RememberConn,
  promoted: boolean,
): boolean {
  if (promoted) return false
  if (!authPending || authPending.conn !== conn) return false
  if (!conn.open) return false
  return true
}
