import { isRelayOnly } from './relay'
import { buildRtcConfiguration, mergeIceServers } from './peerConfig'
import { fetchTurnPayload } from './turnFetch'

export { TURN_FETCH_MS, fetchTurnPayload } from './turnFetch'

export async function loadRtcConfiguration(fetchTurn = fetch): Promise<RTCConfiguration> {
  const relayOnly = isRelayOnly()
  const payload = await fetchTurnPayload(fetchTurn)
  return buildRtcConfiguration(mergeIceServers(payload), relayOnly)
}
