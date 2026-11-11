const RELAY_KEY = 'pp-relay'

/** Read `?relay=1`, persist in sessionStorage, survive `/j/CODE` navigation. */
export function syncRelayFromUrl(search = location.search): boolean {
  const relay = new URLSearchParams(search).get('relay') === '1'
  if (relay) sessionStorage.setItem(RELAY_KEY, '1')
  return relay || sessionStorage.getItem(RELAY_KEY) === '1'
}

export function isRelayOnly(): boolean {
  return sessionStorage.getItem(RELAY_KEY) === '1'
}

function normalizeJoinCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export function withRelayQuery(path: string, relayOnly = isRelayOnly()): string {
  if (!relayOnly) return path
  const q = path.indexOf('?')
  const base = q === -1 ? path : path.slice(0, q)
  const params = new URLSearchParams(q === -1 ? '' : path.slice(q + 1))
  params.set('relay', '1')
  return `${base}?${params}`
}

export function joinPathFor(code: string, relayOnly: boolean): string {
  const base = `/j/${normalizeJoinCode(code)}`
  return relayOnly ? `${base}?relay=1` : base
}

export function joinPath(code: string): string {
  return joinPathFor(code, isRelayOnly())
}

export function joinUrl(origin: string, code: string): string {
  return `${origin}${joinPath(code)}`
}

/** Phone code-entry home (`/`). */
export function entryPath(): string {
  return withRelayQuery('/')
}

/** Force laptop host mode from a phone. */
export function hostEntryPath(): string {
  return withRelayQuery('/?as=host')
}
