const B32 = 'abcdefghijklmnopqrstuvwxyz234567'

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += B32[(value >>> bits) & 31]
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function newListenId(): string {
  return bytesToBase32(randomBytes(16))
}

export function newPhoneId(): string {
  return bytesToBase32(randomBytes(16))
}

export function newPhoneKey(): Uint8Array {
  return randomBytes(32)
}

export function keyToB64(key: Uint8Array): string {
  let s = ''
  for (let i = 0; i < key.length; i++) s += String.fromCharCode(key[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function keyFromB64(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToB64(bytes: Uint8Array): string {
  return keyToB64(bytes)
}

export function bytesFromB64(s: string): Uint8Array {
  return keyFromB64(s)
}

export const listenPeerId = (listenId: string) => `phonepair-r-${listenId}`
