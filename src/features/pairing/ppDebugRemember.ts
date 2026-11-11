import { ppDebug } from './ppDebug.ts'

export function truncateRememberTarget(listenPeerId: string): string {
  if (listenPeerId.length <= 12) return listenPeerId
  return `${listenPeerId.slice(0, 6)}…${listenPeerId.slice(-4)}`
}

export function ppDebugRememberDial(targetPeerId: string): void {
  const r = ppDebug().remember
  r.dials += 1
  r.lastTarget = truncateRememberTarget(targetPeerId)
}

export function ppDebugRememberDialError(errorType: string): void {
  const r = ppDebug().remember
  const key = errorType || 'unknown'
  r.dialErrors[key] = (r.dialErrors[key] ?? 0) + 1
}

export function ppDebugRememberAuthSent(): void {
  ppDebug().remember.authSent += 1
}
