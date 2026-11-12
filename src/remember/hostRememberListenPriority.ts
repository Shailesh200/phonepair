/** Allow listen tick forcing before the first `open` on a replacement socket after a signaling drop. */
export function listenForceTickAllowed(
  listenPeerEverOpen: boolean,
  listenUnverifiedAfterDrop: boolean,
): boolean {
  return listenPeerEverOpen || listenUnverifiedAfterDrop
}
