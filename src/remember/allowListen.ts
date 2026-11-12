/** When the live session rides the remember listen peer, do not tear it down to refresh. */
export function shouldRestartListenPeer(connOnListenPeer: boolean): boolean {
  return !connOnListenPeer
}
