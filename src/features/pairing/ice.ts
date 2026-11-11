import { isRelayOnly } from './relay'
import { buildRtcConfiguration, mergeIceServers, type TurnPayload } from './peerConfig'

export async function loadRtcConfiguration(fetchTurn = fetch): Promise<RTCConfiguration> {
  let payload: TurnPayload | null = null
  try {
    const r = await fetchTurn('/api/turn', { cache: 'no-store' })
    if (r.ok) payload = await r.json()
  } catch {}
  return buildRtcConfiguration(mergeIceServers(payload), isRelayOnly())
}
