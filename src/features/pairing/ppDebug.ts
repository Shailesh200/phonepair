export type PpDebugListenRejects = {
  authPending: number
  backoff: number
  mainConnOpen: number
  mainConnOtherPhone: number
}

export type PpDebugForceRuns = {
  hook: number
  online: number
  tick: number
  cadence: number
  retry: number
}

export type PpDebugRemember = {
  dials: number
  dialOpened: number
  dialErrors: Record<string, number>
  authSent: number
}

export type PpDebugGuestRedials = {
  scheduled: number
  immediate: number
  lastDelayMs: number
  delaysMs: number[]
}

export type PpDebugGuestSignal = {
  socketOpens: number
  forces: PpDebugForceRuns
  redials: PpDebugGuestRedials
}

export type RunForceKind = keyof PpDebugForceRuns

export type PpDebugListenHost = import('./ppDebugListenHost.ts').PpDebugListenHost

export type PpDebugForceDrops = import('./ppDebugForceDrops.ts').PpDebugForceDrops

export type PpDebugState = {
  listenRejects: PpDebugListenRejects
  listenHost?: PpDebugListenHost
  forceDrops?: { listen: PpDebugForceDrops; code: PpDebugForceDrops }
  listenSocketOpens: number
  listenSocketClosedConnecting: number
  listenUnavailableId: number
  listenBootstrap: number
  forces: { listen: PpDebugForceRuns; code: PpDebugForceRuns }
  guest: PpDebugGuestSignal
  relayFallbackNoTurn: number
  remember: PpDebugRemember
  ice: import('./ppDebugIce.ts').PpDebugIce
}

let nodeFallbackDebug: PpDebugState | null = null

export function zeroForceRuns(): PpDebugForceRuns {
  return { hook: 0, online: 0, tick: 0, cadence: 0, retry: 0 }
}

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
    listenUnavailableId: 0,
    listenBootstrap: 0,
    forces: { listen: zeroForceRuns(), code: zeroForceRuns() },
    guest: {
      socketOpens: 0,
      forces: zeroForceRuns(),
      redials: { scheduled: 0, immediate: 0, lastDelayMs: 0, delaysMs: [] },
    },
    relayFallbackNoTurn: 0,
    remember: { dials: 0, dialOpened: 0, dialErrors: {}, authSent: 0 },
    ice: {
      connGeneration: 0,
      abandonOnSignalDrop: 0,
      last: null,
      samples: [],
    },
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

/** Eager init so phone/home surfaces never show null before link starts. */
export function ensurePpDebug(): PpDebugState {
  return ppDebug()
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

export function ppDebugIncListenUnavailableId(): void {
  ppDebug().listenUnavailableId += 1
}

export function ppDebugIncListenBootstrap(): void {
  ppDebug().listenBootstrap += 1
}

export function ppDebugIncForceRun(which: 'listen' | 'code', kind: RunForceKind): void {
  ppDebug().forces[which][kind] += 1
}

export function ppDebugIncGuestSocketOpen(): void {
  ppDebug().guest.socketOpens += 1
}

export function ppDebugIncGuestForce(kind: RunForceKind = 'tick'): void {
  ppDebug().guest.forces[kind] += 1
}

export function ppDebugRecordGuestRedial(delayMs: number): void {
  const r = ppDebug().guest.redials
  r.lastDelayMs = delayMs
  if (delayMs <= 0) r.immediate += 1
  else {
    r.scheduled += 1
    r.delaysMs.push(delayMs)
    if (r.delaysMs.length > 24) r.delaysMs.shift()
  }
}

export function ppDebugIncRelayFallbackNoTurn(): void {
  ppDebug().relayFallbackNoTurn += 1
}

declare global {
  interface Window {
    __ppDebug?: PpDebugState
  }
}
