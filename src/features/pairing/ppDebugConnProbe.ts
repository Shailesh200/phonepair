import { ppDebug } from './ppDebug.ts'

export type PpDebugConnProbe = {
  probesSent: number
  probePong: number
  probeTimeout: number
  probeMsLast: number | null
  stalledWsKilled: number
  staleDataRebuild: number
}

export function ensurePpDebugConnProbe(): PpDebugConnProbe {
  const d = ppDebug()
  if (!d.connProbe) {
    d.connProbe = {
      probesSent: 0,
      probePong: 0,
      probeTimeout: 0,
      probeMsLast: null,
      stalledWsKilled: 0,
      staleDataRebuild: 0,
    }
  }
  return d.connProbe
}

export function ppDebugIncProbeSent(): void {
  ensurePpDebugConnProbe().probesSent += 1
}

export function ppDebugRecordProbePong(ms: number): void {
  const p = ensurePpDebugConnProbe()
  p.probePong += 1
  p.probeMsLast = ms
}

export function ppDebugIncProbeTimeout(): void {
  ensurePpDebugConnProbe().probeTimeout += 1
}

export function ppDebugIncStalledWsKilled(): void {
  ensurePpDebugConnProbe().stalledWsKilled += 1
}

export function ppDebugIncStaleDataRebuild(): void {
  ensurePpDebugConnProbe().staleDataRebuild += 1
}
