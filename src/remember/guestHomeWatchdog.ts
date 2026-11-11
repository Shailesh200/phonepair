import { MSG_REMEMBER_UNREACHABLE } from '../features/pairing/errors.ts'

export function shouldFailRememberGuestHome(opts: {
  rememberGuest: boolean
  everConnected: boolean
  status: string
  elapsedMs: number
  limitMs: number
}): boolean {
  if (!opts.rememberGuest || opts.everConnected) return false
  if (opts.status === 'connected' || opts.status === 'error') return false
  if (opts.elapsedMs <= opts.limitMs) return false
  return true
}

export function rememberGuestHomeError(): string {
  return MSG_REMEMBER_UNREACHABLE
}
