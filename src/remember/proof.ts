import { hmacSha256, verifyHmac } from './crypto.ts'

export const PHONE_HMAC_PREFIX = new TextEncoder().encode('pp-r-phone|')
export const HOST_HMAC_PREFIX = new TextEncoder().encode('pp-r-host|')

export function proofPayload(prefix: Uint8Array, nonce: Uint8Array): Uint8Array {
  const out = new Uint8Array(prefix.length + nonce.length)
  out.set(prefix, 0)
  out.set(nonce, prefix.length)
  return out
}

export async function signPhoneProof(key: Uint8Array, hostNonce: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(key, proofPayload(PHONE_HMAC_PREFIX, hostNonce))
}

export async function signHostProof(key: Uint8Array, phoneNonce: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(key, proofPayload(HOST_HMAC_PREFIX, phoneNonce))
}

export async function verifyPhoneProof(key: Uint8Array, hostNonce: Uint8Array, proof: Uint8Array): Promise<boolean> {
  return verifyHmac(key, proofPayload(PHONE_HMAC_PREFIX, hostNonce), proof)
}

export async function verifyHostProof(key: Uint8Array, phoneNonce: Uint8Array, proof: Uint8Array): Promise<boolean> {
  return verifyHmac(key, proofPayload(HOST_HMAC_PREFIX, phoneNonce), proof)
}
