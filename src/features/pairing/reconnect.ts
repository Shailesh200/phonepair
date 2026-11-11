export function redialDelayMs(attempt: number, everConnected: boolean): number {
  if (!everConnected && attempt <= 1) return 0
  const base = everConnected ? 800 : 1500
  return Math.min(Math.round(base * Math.pow(1.55, attempt)), 14_000)
}

/** PeerJS `peer-unavailable` before first hello — treat as unknown / offline host. */
export function guestUnavailableRetries(everConnected: boolean): number {
  return everConnected ? 12 : 6
}
