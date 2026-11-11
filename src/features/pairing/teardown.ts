/** Deliberate user disconnect notifies the peer; tab unload / destroy does not. */
export function linkTeardownSendsBye(mode: 'destroy' | 'disconnect'): boolean {
  return mode === 'disconnect'
}
