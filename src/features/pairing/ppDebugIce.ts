import { selectedCandidatePairTypes } from './relayStats.ts'
import { ppDebug } from './ppDebug.ts'

export type PpDebugIceSample = {
  connGen: number
  dataConnectedAt: number
  iceConnectedAt: number | null
  dataToIceMs: number | null
  localCandidateType: string
  remoteCandidateType: string
}

export type PpDebugIce = {
  connGeneration: number
  abandonOnSignalDrop: number
  last: PpDebugIceSample | null
  samples: PpDebugIceSample[]
}

function ensureIce(): PpDebugIce {
  const d = ppDebug()
  if (!d.ice.samples) {
    d.ice = {
      connGeneration: 0,
      abandonOnSignalDrop: 0,
      last: null,
      samples: [],
    }
  }
  return d.ice
}

export function ppDebugIce(): PpDebugIce {
  return ensureIce()
}

export function ppDebugIncAbandonOnSignalDrop(): void {
  ppDebugIce().abandonOnSignalDrop += 1
}

export function ppDebugRecordDataConnected(now = Date.now()): number {
  const ice = ensureIce()
  ice.connGeneration += 1
  const sample: PpDebugIceSample = {
    connGen: ice.connGeneration,
    dataConnectedAt: now,
    iceConnectedAt: null,
    dataToIceMs: null,
    localCandidateType: '',
    remoteCandidateType: '',
  }
  ice.last = sample
  ice.samples.push(sample)
  if (ice.samples.length > 8) ice.samples.shift()
  return ice.connGeneration
}

export async function ppDebugRecordIceTransport(pc: RTCPeerConnection, gen: number, now = Date.now()): Promise<void> {
  const ice = ensureIce()
  let sample = ice.samples.find((s) => s.connGen === gen) ?? ice.last
  if (!sample || sample.connGen !== gen) return
  if (sample.iceConnectedAt != null) return
  try {
    const types = selectedCandidatePairTypes(await pc.getStats())
    sample.iceConnectedAt = now
    sample.dataToIceMs = now - sample.dataConnectedAt
    sample.localCandidateType = types?.local ?? ''
    sample.remoteCandidateType = types?.remote ?? ''
    ice.last = { ...sample }
  } catch {
    sample.iceConnectedAt = now
    sample.dataToIceMs = now - sample.dataConnectedAt
  }
}
