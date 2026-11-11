/** Pairing codes: A–Z and 2–9, excluding I, O, 0, and 1. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function normalizePairCode(raw: string): string {
  const upper = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  let out = ''
  for (const c of upper) {
    if (!CODE_ALPHABET.includes(c)) continue
    out += c
    if (out.length === 6) break
  }
  return out
}

export function isValidPairCode(code: string): boolean {
  if (code.length !== 6) return false
  for (let i = 0; i < 6; i++) if (!CODE_ALPHABET.includes(code[i])) return false
  return true
}

export const peerIdForCode = (code: string) => 'phonepair-' + code.toLowerCase()

export function newPairCode(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}
