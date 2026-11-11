export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

export type TurnPayload = { iceServers?: RTCIceServer[] }

export function buildRtcConfiguration(
  iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  relayOnly = false,
): RTCConfiguration {
  return {
    iceServers: iceServers.length ? iceServers : DEFAULT_ICE_SERVERS,
    iceTransportPolicy: relayOnly ? 'relay' : 'all',
  }
}

export function mergeIceServers(fetched: TurnPayload | null | undefined): RTCIceServer[] {
  const fromApi = fetched?.iceServers
  if (Array.isArray(fromApi) && fromApi.length) return fromApi
  return DEFAULT_ICE_SERVERS
}
