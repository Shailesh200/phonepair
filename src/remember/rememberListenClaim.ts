export const REMEMBER_LISTEN_MAX_SOCKETS = 3
export const REMEMBER_LISTEN_UNAVAILABLE_GIVE_UP = 2
export const REMEMBER_LISTEN_WINDOW_MS = 60_000
export const REMEMBER_LISTEN_BURST_WINDOW_MS = 10_000

export function listenClaimGiveUp(unavailableFailures: number, _socketsOpened: number): boolean {
  if (unavailableFailures >= REMEMBER_LISTEN_UNAVAILABLE_GIVE_UP) return true
  return false
}

export function listenUnavailableBurstCapReached(
  unavailableFailureTimes: number[],
  now: number,
  ownedBefore: boolean,
): boolean {
  if (ownedBefore) return false
  const recent = unavailableFailureTimes.filter((t) => now - t < REMEMBER_LISTEN_BURST_WINDOW_MS)
  return recent.length >= REMEMBER_LISTEN_MAX_SOCKETS
}

export function canOpenRememberListenSocket(
  gaveUp: boolean,
  unavailableFailureTimes: number[],
  now: number,
  ownedBefore: boolean,
): boolean {
  if (gaveUp) return false
  if (listenUnavailableBurstCapReached(unavailableFailureTimes, now, ownedBefore)) return false
  return true
}

export function socketsOpenedInWindow(openTimes: number[], now: number): number {
  return openTimes.filter((t) => now - t < REMEMBER_LISTEN_WINDOW_MS).length
}
