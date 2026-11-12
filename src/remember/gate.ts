export const REMEMBER_PROOF_TIMEOUT_MS = 5000

export type RememberGatePhase = 'off' | 'await-hello' | 'await-proof' | 'open' | 'closed'

export function gateAllowsFeatureData(phase: RememberGatePhase): boolean {
  return phase === 'open' || phase === 'off'
}

/** Control messages handled during remember auth; anything else is dropped until open. */
export function gateMessageDisposition(
  phase: RememberGatePhase,
  msgType: string,
): 'control' | 'feature' | 'drop' {
  if (phase === 'off' || phase === 'open') {
    return gateAllowsFeatureData(phase) ? 'feature' : 'drop'
  }
  if (phase === 'closed') return 'drop'
  if (msgType === 'remember:hello' || msgType === 'remember:challenge' || msgType === 'remember:proof' || msgType === 'remember:ok') {
    return 'control'
  }
  return 'drop'
}

export function gateAfterValidProof(phase: RememberGatePhase): RememberGatePhase {
  return phase === 'await-proof' ? 'open' : phase
}

export function gateOnAuthFailure(_phase: RememberGatePhase): RememberGatePhase {
  return 'closed'
}
