export type SelectedPairIds = { localId?: string; remoteId?: string }

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
