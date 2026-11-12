export const REMEMBER_AUTH_PENDING_SUPERSEDE_MS = 3000

export type RememberAcceptReject =
  | 'backoff'
  | 'authPending'
  | 'mainConnOtherPhone'

export function authPendingBlocksAccept(
  hasPending: boolean,
  pendingAgeMs: number,
  supercedeMs = REMEMBER_AUTH_PENDING_SUPERSEDE_MS,
): boolean {
  return hasPending && pendingAgeMs < supercedeMs
}

export function mainConnBlocksRememberAccept(
  mainConnOpen: boolean,
  knownPhoneId: string | undefined,
  mainConnPhoneId: string | null | undefined,
): boolean {
  if (!mainConnOpen) return false
  if (!knownPhoneId) return false
  if (!mainConnPhoneId) return true
  return knownPhoneId !== mainConnPhoneId
}

export function rememberAcceptAllowed(opts: {
  now: number
  backoffUntil: number
  hasPending: boolean
  pendingStartedAt: number | null
  mainConnOpen: boolean
  knownPhoneId?: string
  mainConnPhoneId?: string | null
}): { accept: boolean; reject?: RememberAcceptReject; supersedePending: boolean } {
  if (opts.now < opts.backoffUntil) {
    return { accept: false, reject: 'backoff', supersedePending: false }
  }
  const pendingAge = opts.pendingStartedAt != null ? opts.now - opts.pendingStartedAt : 0
  if (authPendingBlocksAccept(opts.hasPending, pendingAge)) {
    return { accept: false, reject: 'authPending', supersedePending: false }
  }
  const supersedePending = opts.hasPending && pendingAge >= REMEMBER_AUTH_PENDING_SUPERSEDE_MS
  if (mainConnBlocksRememberAccept(opts.mainConnOpen, opts.knownPhoneId, opts.mainConnPhoneId)) {
    return { accept: false, reject: 'mainConnOtherPhone', supersedePending }
  }
  return { accept: true, supersedePending }
}
