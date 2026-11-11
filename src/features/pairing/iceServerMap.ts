/** Keep every ICE URL from /api/turn (turn:, turns:, ?transport=tcp, etc.). */
export function iceServersFromTurnApi(iceServers: RTCIceServer[] | undefined): RTCIceServer[] {
  if (!Array.isArray(iceServers) || !iceServers.length) return []
  return iceServers.map((entry) => {
    const raw = entry.urls
    const list = Array.isArray(raw) ? [...raw] : raw ? [raw] : []
    const urls: string | string[] = list.length === 1 ? list[0]! : list
    return { ...entry, urls }
  })
}

export function iceServersHaveTurn(servers: RTCIceServer[]): boolean {
  return allIceUrls(servers).some((u) => /^turns?:/i.test(u))
}

export function allIceUrls(servers: RTCIceServer[]): string[] {
  const out: string[] = []
  for (const s of servers) {
    if (Array.isArray(s.urls)) out.push(...s.urls)
    else if (s.urls) out.push(s.urls)
  }
  return out
}
