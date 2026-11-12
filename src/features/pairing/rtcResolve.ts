import { ppDebugIncRelayFallbackNoTurn } from './ppDebug.ts'
import { iceServersHaveTurn } from './iceServerMap.ts'
import { buildRtcConfiguration, mergeIceServers, type TurnPayload } from './peerConfig.ts'

export function effectiveRelayOnly(
  iceServers: RTCIceServer[],
  relayOnlyRequested: boolean,
): { relayOnly: boolean; fellBack: boolean } {
  if (!relayOnlyRequested) return { relayOnly: false, fellBack: false }
  if (iceServersHaveTurn(iceServers)) return { relayOnly: true, fellBack: false }
  return { relayOnly: false, fellBack: true }
}

export function rtcConfigurationFromTurnPayload(
  payload: TurnPayload | null | undefined,
  relayOnlyRequested: boolean,
): RTCConfiguration {
  const iceServers = mergeIceServers(payload)
  const { relayOnly, fellBack } = effectiveRelayOnly(iceServers, relayOnlyRequested)
  if (fellBack) ppDebugIncRelayFallbackNoTurn()
  return buildRtcConfiguration(iceServers, relayOnly)
}
