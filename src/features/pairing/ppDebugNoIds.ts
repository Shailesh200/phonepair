/** Leaf string values allowed on __ppDebug (enums / error labels, not peer or pairing ids). */
export const PP_DEBUG_ALLOWED_STRINGS = new Set([
  '',
  'host',
  'srflx',
  'relay',
  'prflx',
  'peer-unavailable',
  'network',
  'server-error',
  'socket-error',
  'socket-closed',
  'unknown',
])

export function ppDebugStringLooksLikeId(value: string): boolean {
  if (PP_DEBUG_ALLOWED_STRINGS.has(value)) return false
  if (/^phonepair-/i.test(value)) return true
  if (/^[A-Z2-9]{6}$/.test(value)) return true
  if (/…/.test(value)) return true
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) return true
  if (value.length >= 14 && /^[a-zA-Z0-9._-]+$/.test(value) && !value.includes('/')) return true
  return false
}

export function assertPpDebugHasNoIds(root: unknown, path = '__ppDebug'): void {
  if (root == null || typeof root === 'number' || typeof root === 'boolean') return
  if (typeof root === 'string') {
    if (ppDebugStringLooksLikeId(root)) {
      throw new Error(`${path}: string looks like an id: ${JSON.stringify(root)}`)
    }
    return
  }
  if (Array.isArray(root)) {
    root.forEach((v, i) => assertPpDebugHasNoIds(v, `${path}[${i}]`))
    return
  }
  if (typeof root === 'object') {
    for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
      const child = `${path}.${k}`
      if (
        child.endsWith('.dialErrors')
        && typeof v === 'object'
        && v != null
      ) {
        for (const [errKey] of Object.entries(v as Record<string, unknown>)) {
          if (!PP_DEBUG_ALLOWED_STRINGS.has(errKey) && ppDebugStringLooksLikeId(errKey)) {
            throw new Error(`${child}.${errKey}: dialErrors key looks like an id`)
          }
        }
      }
      assertPpDebugHasNoIds(v, child)
    }
  }
}
