/** Host accepts remember:forget only on the authenticated listen session for that phone. */
export function hostAcceptsRememberForget(
  onListenPeer: boolean,
  authenticatedPhoneId: string | null,
  phoneId: string,
): boolean {
  if (!onListenPeer || !authenticatedPhoneId || !phoneId) return false
  return authenticatedPhoneId === phoneId
}
