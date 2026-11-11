/** Phone-initiated forget on the host: listen-authed conn or open code pair with matching listenId. */
export function hostAcceptsPhoneForget(
  opts: {
    fromListenPeer: boolean
    fromCodePeer: boolean
    storeListenId: string | null
    msgListenId: string
    authenticatedPhoneId: string | null
    phoneId: string
    phoneKnown: boolean
  },
): boolean {
  const { fromListenPeer, fromCodePeer, storeListenId, msgListenId, authenticatedPhoneId, phoneId, phoneKnown } = opts
  if (!phoneId) return false
  if (msgListenId && storeListenId && msgListenId !== storeListenId) return false
  if (fromListenPeer) {
    if (!phoneKnown) return false
    return authenticatedPhoneId === phoneId
  }
  if (fromCodePeer && phoneKnown) {
    return !!storeListenId && (!msgListenId || msgListenId === storeListenId)
  }
  return false
}
