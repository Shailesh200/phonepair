import { ppDebug } from './ppDebug.ts'

export function ppDebugRememberDial(_targetPeerId: string): void {
  ppDebug().remember.dials += 1
}

export function ppDebugRememberDialError(errorType: string): void {
  const r = ppDebug().remember
  const key = errorType || 'unknown'
  r.dialErrors[key] = (r.dialErrors[key] ?? 0) + 1
}

export function ppDebugRememberAuthSent(): void {
  ppDebug().remember.authSent += 1
}
