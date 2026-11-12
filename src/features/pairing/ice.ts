import { isRelayOnly } from './relay'
import { fetchTurnPayload, fetchTurnPayloadWithRetry } from './turnFetch'
import { rtcConfigurationFromTurnPayload } from './rtcResolve'

export {
  TURN_FETCH_MS,
  TURN_FETCH_RETRY_ATTEMPTS,
  fetchTurnPayload,
  fetchTurnPayloadWithRetry,
} from './turnFetch'

export async function loadRtcConfiguration(fetchTurn = fetch): Promise<RTCConfiguration> {
  const relayOnlyRequested = isRelayOnly()
  const payload = await fetchTurnPayloadWithRetry(fetchTurn)
  return rtcConfigurationFromTurnPayload(payload, relayOnlyRequested)
}
