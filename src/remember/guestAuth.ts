import { bytesFromB64 } from './ids.ts'
import { verifyHostProof } from './proof.ts'

export type RememberOkMsg = { t?: string; hostProof?: string }

/** Guest accepts remember:ok only when hostProof matches the phone nonce. */
export async function guestAcceptsRememberOk(
  msg: RememberOkMsg,
  key: Uint8Array,
  phoneNonce: Uint8Array,
): Promise<boolean> {
  if (msg.t !== 'remember:ok' || typeof msg.hostProof !== 'string' || !msg.hostProof) return false
  try {
    const proof = bytesFromB64(msg.hostProof)
    return verifyHostProof(key, phoneNonce, proof)
  } catch {
    return false
  }
}
