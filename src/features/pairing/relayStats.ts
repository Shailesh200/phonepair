export type SelectedPairIds = { localId?: string; remoteId?: string }

export type SelectedPairTypes = { local?: string; remote?: string }

export function selectedCandidatePairIds(stats: RTCStatsReport): SelectedPairIds | null {
  let remoteId = ''
  let localId = ''
  stats.forEach((report) => {
    if (report.type === 'transport') {
      const id = (report as RTCTransportStats).selectedCandidatePairId
      const pair = id ? stats.get(id) : undefined
      if (pair?.type === 'candidate-pair') {
        const p = pair as RTCIceCandidatePairStats
        if (p.localCandidateId) localId = p.localCandidateId
        if (p.remoteCandidateId) remoteId = p.remoteCandidateId
      }
    }
  })
  if (!remoteId && !localId) {
    stats.forEach((report) => {
      if (report.type !== 'candidate-pair') return
      const p = report as RTCIceCandidatePairStats
      if (p.nominated && p.state === 'succeeded') {
        if (p.localCandidateId) localId = p.localCandidateId
        if (p.remoteCandidateId) remoteId = p.remoteCandidateId
      }
    })
  }
  if (!remoteId && !localId) return null
  return { localId: localId || undefined, remoteId: remoteId || undefined }
}

type CandidateStat = RTCStats & { candidateType?: string }

function candidateType(stats: RTCStatsReport, id?: string): string | undefined {
  if (!id) return undefined
  const c = stats.get(id) as CandidateStat | undefined
  if (c && (c.type === 'remote-candidate' || c.type === 'local-candidate')) return c.candidateType
  return undefined
}

export function selectedCandidatePairTypes(stats: RTCStatsReport): SelectedPairTypes | null {
  const pair = selectedCandidatePairIds(stats)
  if (!pair) return null
  return {
    local: candidateType(stats, pair.localId),
    remote: candidateType(stats, pair.remoteId),
  }
}

export function candidatePairUsesRelay(stats: RTCStatsReport): boolean | null {
  const pair = selectedCandidatePairIds(stats)
  if (!pair) return null
  let relay = false
  for (const id of [pair.localId, pair.remoteId]) {
    if (!id) continue
    const c = stats.get(id) as CandidateStat | undefined
    if (c && (c.type === 'remote-candidate' || c.type === 'local-candidate') && c.candidateType === 'relay') {
      relay = true
    }
  }
  return relay
}
