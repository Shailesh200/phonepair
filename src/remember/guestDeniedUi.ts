import { MSG_REMEMBER_DENIED } from '../features/pairing/errors.ts'

export function routeRememberDeniedToEntry(error: string | undefined): boolean {
  return error === MSG_REMEMBER_DENIED
}
