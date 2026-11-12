/** Remember phones use the listen peer for data; do not storm the code peer's force runner. */
export function shouldInhibitHostCodePeerForce(hasRememberPhones: boolean): boolean {
  return hasRememberPhones
}

/** Allow listen tick forcing before the first `open` on a replacement socket after a signaling drop. */
export function listenForceTickAllowed(
  listenPeerEverOpen: boolean,
  listenUnverifiedAfterDrop: boolean,
): boolean {
  return listenPeerEverOpen || listenUnverifiedAfterDrop
}
