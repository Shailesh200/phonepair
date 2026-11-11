export function shouldPromoteOverConn(
  liveConn: { open: boolean } | null,
  incoming: unknown,
): boolean {
  if (liveConn?.open && liveConn !== incoming) return false
  return true
}
