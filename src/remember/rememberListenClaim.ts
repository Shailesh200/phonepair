export const REMEMBER_LISTEN_MAX_SOCKETS = 3
export const REMEMBER_LISTEN_UNAVAILABLE_GIVE_UP = 2
export const REMEMBER_LISTEN_WINDOW_MS = 60_000

export function listenClaimGiveUp(unavailableFailures: number, socketsOpened: number): boolean {
  if (unavailableFailures >= REMEMBER_LISTEN_UNAVAILABLE_GIVE_UP) return true
  if (socketsOpened >= REMEMBER_LISTEN_MAX_SOCKETS) return true
  return false
}

export function canOpenRememberListenSocket(
  socketsOpened: number,
  gaveUp: boolean,
  openTimes: number[],
  now: number,
): boolean {
  if (gaveUp) return false
  if (socketsOpened >= REMEMBER_LISTEN_MAX_SOCKETS) return false
  const recent = openTimes.filter((t) => now - t < REMEMBER_LISTEN_WINDOW_MS)
  return recent.length < REMEMBER_LISTEN_MAX_SOCKETS
}

export function socketsOpenedInWindow(openTimes: number[], now: number): number {
  return openTimes.filter((t) => now - t < REMEMBER_LISTEN_WINDOW_MS).length
}
