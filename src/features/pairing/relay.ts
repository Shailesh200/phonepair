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

export function joinPath(code: string): string {
  const base = `/j/${normalizeJoinCode(code)}`
  return isRelayOnly() ? `${base}?relay=1` : base
}

function normalizeJoinCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export function joinUrl(origin: string, code: string): string {
  return `${origin}${joinPath(code)}`
}
