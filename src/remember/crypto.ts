async function importHmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await importHmacKey(key)
  const sig = await crypto.subtle.sign('HMAC', k, data)
  return new Uint8Array(sig)
}

export async function verifyHmac(key: Uint8Array, data: Uint8Array, proof: Uint8Array): Promise<boolean> {
  const k = await importHmacKey(key)
  return crypto.subtle.verify('HMAC', k, proof, data)
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}
