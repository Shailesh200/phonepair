import { hmacSha256, verifyHmac } from './crypto.ts'

export const PHONE_HMAC_PREFIX = new TextEncoder().encode('pp-r-phone|')
export const HOST_HMAC_PREFIX = new TextEncoder().encode('pp-r-host|')

export function proofPayloadDual(prefix: Uint8Array, first: Uint8Array, second: Uint8Array): Uint8Array {
  const out = new Uint8Array(prefix.length + first.length + second.length)
  out.set(prefix, 0)
  out.set(first, prefix.length)
  out.set(second, prefix.length + first.length)
  return out
}

export async function signPhoneProof(key: Uint8Array, phoneNonce: Uint8Array, hostNonce: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(key, proofPayloadDual(PHONE_HMAC_PREFIX, phoneNonce, hostNonce))
}

export async function signHostProof(key: Uint8Array, hostNonce: Uint8Array, phoneNonce: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(key, proofPayloadDual(HOST_HMAC_PREFIX, hostNonce, phoneNonce))
}

export async function verifyPhoneProof(
  key: Uint8Array,
  phoneNonce: Uint8Array,
  hostNonce: Uint8Array,
  proof: Uint8Array,
): Promise<boolean> {
  return verifyHmac(key, proofPayloadDual(PHONE_HMAC_PREFIX, phoneNonce, hostNonce), proof)
}

export async function verifyHostProof(
  key: Uint8Array,
  hostNonce: Uint8Array,
  phoneNonce: Uint8Array,
  proof: Uint8Array,
): Promise<boolean> {
  return verifyHmac(key, proofPayloadDual(HOST_HMAC_PREFIX, hostNonce, phoneNonce), proof)
}
