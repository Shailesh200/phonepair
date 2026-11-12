import {
  shouldAbandonOpenDataConn,
  type AbandonOpenDataConnInput,
} from '../features/pairing/iceRecovery.ts'

export function guestRememberDialShouldClearOpenConn(
  input: AbandonOpenDataConnInput & { rememberGuest: boolean; status: string },
): boolean {
  if (!input.rememberGuest || !input.dataConnOpen) return false
  if (input.status !== 'reconnecting' && input.status !== 'connecting') return false
  return shouldAbandonOpenDataConn(input)
}
