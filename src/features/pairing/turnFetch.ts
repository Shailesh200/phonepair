import type { TurnPayload } from './peerConfig'

export const TURN_FETCH_MS = 1500

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
