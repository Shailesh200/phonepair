import { MSG_REMEMBER_UNREACHABLE } from '../features/pairing/errors.ts'

export function shouldFailRememberGuestHome(opts: {
  rememberGuest: boolean
  sessionPaired: boolean
  rememberEverAuthed?: boolean
  status: string
  deadlineMs: number
  now: number
}): boolean {
  if (!opts.rememberGuest || opts.sessionPaired || opts.rememberEverAuthed) return false
  if (opts.status === 'connected' || opts.status === 'error') return false
  if (!opts.deadlineMs || opts.now < opts.deadlineMs) return false
  return true
}

export function rememberGuestHomeError(): string {
  return MSG_REMEMBER_UNREACHABLE
}
