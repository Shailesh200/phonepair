export const MSG_HOST_NOT_FOUND =
  "Couldn't find that code. Check your laptop and try again."

export const MSG_CODE_MISMATCH =
  "That code didn't match. Check the code on your laptop and try again."

export const MSG_CODE_EXPIRED =
  'This code has expired. Refresh the laptop page for a new one.'

export const MSG_REMEMBER_UNREACHABLE =
  "Couldn't reach your laptop. Use the code."

export const MSG_REMEMBER_DENIED =
  'This laptop no longer remembers this phone'

const GUEST_PAIRED_KEY = 'pp-guest-paired-code'

export function rememberGuestPairedCode(code: string) {
  try { sessionStorage.setItem(GUEST_PAIRED_KEY, code) } catch {}
}

export function lastGuestPairedCode(): string | null {
  try { return sessionStorage.getItem(GUEST_PAIRED_KEY) } catch { return null }
}

export type GuestErrorReason = 'mismatch' | 'expired'

export function classifyGuestPairError(input: {
  code: string
  everConnectedThisSession: boolean
  previouslyPairedCode: string | null
}): GuestErrorReason {
  if (input.everConnectedThisSession) return 'expired'
  if (input.previouslyPairedCode && input.previouslyPairedCode === input.code) return 'expired'
  return 'mismatch'
}

export function guestErrorText(reason: GuestErrorReason): string {
  return reason === 'expired' ? MSG_CODE_EXPIRED : MSG_CODE_MISMATCH
}

/** Initial guest dial: host peer id missing on the signal server — not a transient drop. */
export function guestFailFastOnPeerUnavailable(role: string, everConnected: boolean): boolean {
  return role === 'guest' && !everConnected
}
