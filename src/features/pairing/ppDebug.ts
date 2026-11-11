export type PpDebugListenRejects = {
  authPending: number
  backoff: number
  mainConnOpen: number
  mainConnOtherPhone: number
}

export type PpDebugState = {
  listenRejects: PpDebugListenRejects
  listenSocketOpens: number
  listenSocketClosedConnecting: number
  forces: { listen: number; code: number }
  relayFallbackNoTurn: number
}

let nodeFallbackDebug: PpDebugState | null = null

function freshDebug(): PpDebugState {
  return {
    listenRejects: {
      authPending: 0,
      backoff: 0,
      mainConnOpen: 0,
      mainConnOtherPhone: 0,
    },
    listenSocketOpens: 0,
    listenSocketClosedConnecting: 0,
    forces: { listen: 0, code: 0 },
    relayFallbackNoTurn: 0,
  }
}

export function ppDebug(): PpDebugState {
  if (typeof globalThis === 'undefined' || typeof (globalThis as { window?: unknown }).window === 'undefined') {
    if (!nodeFallbackDebug) nodeFallbackDebug = freshDebug()
    return nodeFallbackDebug
  }
  const w = (globalThis as { window: { __ppDebug?: PpDebugState } }).window
  if (!w.__ppDebug) w.__ppDebug = freshDebug()
  return w.__ppDebug
}

export function ppDebugIncListenReject(reason: keyof PpDebugListenRejects): void {
  ppDebug().listenRejects[reason] += 1
}

export function ppDebugIncListenSocketOpen(): void {
  ppDebug().listenSocketOpens += 1
}

export function ppDebugIncListenSocketClosedConnecting(): void {
  ppDebug().listenSocketClosedConnecting += 1
}

export function ppDebugIncForce(which: 'listen' | 'code'): void {
  ppDebug().forces[which] += 1
}

export function ppDebugIncRelayFallbackNoTurn(): void {
  ppDebug().relayFallbackNoTurn += 1
}

declare global {
  interface Window {
    __ppDebug?: PpDebugState
  }
}
