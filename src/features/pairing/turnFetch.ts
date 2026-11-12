import type { TurnPayload } from './peerConfig'

export const TURN_FETCH_MS = 1500
export const TURN_FETCH_RETRY_ATTEMPTS = 2

export async function fetchTurnPayloadWithRetry(
  fetchFn: typeof fetch = fetch,
  opts?: { attempts?: number; timeoutMs?: number },
): Promise<TurnPayload | null> {
  const attempts = opts?.attempts ?? TURN_FETCH_RETRY_ATTEMPTS
  const timeoutMs = opts?.timeoutMs ?? TURN_FETCH_MS
  let last: TurnPayload | null = null
  for (let i = 0; i < attempts; i++) {
    last = await fetchTurnPayload(fetchFn, timeoutMs)
    const servers = last?.iceServers
    if (Array.isArray(servers) && servers.length > 0) return last
    if (i < attempts - 1) continue
  }
  return last
}

export async function fetchTurnPayload(
  fetchFn: typeof fetch = fetch,
  timeoutMs = TURN_FETCH_MS,
): Promise<TurnPayload | null> {
  try {
    const res = await Promise.race([
      fetchFn('/api/turn', { cache: 'no-store' }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ])
    if (!res || !('ok' in res) || !res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
