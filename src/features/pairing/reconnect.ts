export const GUEST_REDIAL_MAX_MS_EVER_CONNECTED = 3_000
export const GUEST_REDIAL_MAX_MS_FIRST_PAIR = 14_000
export const GUEST_UNAVAILABLE_RETRY_MIN_MS = 5 * 60_000
export const GUEST_FIRST_PAIR_UNAVAILABLE_MAX = 6
/** Remember dial while host listen-id is re-registering after a drop. */
export const GUEST_LISTEN_RECOVERY_PEER_UNAVAILABLE_CAP_MS = 5_000
export const GUEST_LISTEN_RECOVERY_PROMPT_FIRST_ATTEMPTS = 3

/** After host is back but listen is not registered yet, space peer-unavailable redials (3s cap when paired). */
export function redialDelayAfterPeerUnavailable(
  consecutivePeerUnavailable: number,
  everConnected: boolean,
  capMs?: number,
): number {
  const cap = capMs ?? (everConnected ? GUEST_REDIAL_MAX_MS_EVER_CONNECTED : GUEST_REDIAL_MAX_MS_FIRST_PAIR)
  if (consecutivePeerUnavailable <= 1) {
    return redialDelayMs(0, everConnected)
  }
  return Math.min(
    redialDelayMs(consecutivePeerUnavailable - 1, everConnected),
    cap,
  )
}

/** Fast remember redials while listen-id catches up — first attempts or before give-up. */
export function guestShouldPromptRedialPeerUnavailableDuringListenRecovery(opts: {
  role: string
  everConnected: boolean
  rememberDial: boolean
  peerOpen: boolean
  peerDisconnected: boolean
  hasInFlightDial: boolean
  nextAttempt: number
  unavailableSince: number | null
  now: number
}): boolean {
  if (opts.role !== 'guest' || !opts.everConnected || !opts.rememberDial) return false
  if (!opts.peerOpen || opts.peerDisconnected || opts.hasInFlightDial) return false
  if (opts.nextAttempt <= GUEST_LISTEN_RECOVERY_PROMPT_FIRST_ATTEMPTS) return true
  if (opts.unavailableSince == null) return false
  return !guestUnavailableShouldGiveUp(
    opts.everConnected,
    opts.nextAttempt,
    opts.unavailableSince,
    opts.now,
  )
}

export function redialDelayMs(attempt: number, everConnected: boolean): number {
  if (attempt === 0) return 0
  if (!everConnected && attempt <= 1) return 0
  const base = everConnected ? 800 : 1500
  const cap = everConnected ? GUEST_REDIAL_MAX_MS_EVER_CONNECTED : GUEST_REDIAL_MAX_MS_FIRST_PAIR
  return Math.min(Math.round(base * Math.pow(1.55, attempt)), cap)
}

/**
 * After `peer.on('open')` or browser `online`, guest backoff is cleared and the next dial is immediate.
 */
export function guestRedialPlanAfterSignalRecovery(everConnected: boolean): {
  retry: number
  delayMs: number
} {
  return { retry: 0, delayMs: redialDelayMs(0, everConnected) }
}

/** PeerJS `peer-unavailable` before first hello — count cap. After pairing, retry at least 5 minutes. */
export function guestUnavailableShouldGiveUp(
  everConnected: boolean,
  attempt: number,
  unavailableSince: number | null,
  now: number,
): boolean {
  if (!everConnected) return attempt > GUEST_FIRST_PAIR_UNAVAILABLE_MAX
  if (unavailableSince == null) return false
  return now - unavailableSince >= GUEST_UNAVAILABLE_RETRY_MIN_MS
}

/** @deprecated Use guestUnavailableShouldGiveUp — kept for older tests referencing counts. */
export function guestUnavailableRetries(everConnected: boolean): number {
  return everConnected ? Number.POSITIVE_INFINITY : GUEST_FIRST_PAIR_UNAVAILABLE_MAX
}
