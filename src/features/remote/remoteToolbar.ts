export type RemoteToolbarMode = 'cursor' | 'pointer'

/** Default: cursor mode (clicks + tap-to-click; laser off). */
export const DEFAULT_REMOTE_TOOLBAR_MODE: RemoteToolbarMode = 'cursor'

export function remoteToolbarShowsClicks(mode: RemoteToolbarMode): boolean {
  return mode === 'cursor'
}

export function remoteToolbarShowsNav(mode: RemoteToolbarMode): boolean {
  return mode === 'pointer'
}

export function remotePointerLaserOnForMode(mode: RemoteToolbarMode): boolean {
  return mode === 'pointer'
}

export function remoteTapSendsClick(mode: RemoteToolbarMode): boolean {
  return mode === 'cursor'
}

/** After a hidden/frozen page, re-send laser on only when still in pointer mode and link is live. */
export function remoteResyncPointerLaserOn(opts: {
  mode: RemoteToolbarMode
  visibilityState: DocumentVisibilityState
  linkConnected: boolean
}): boolean {
  if (opts.visibilityState === 'hidden') return false
  if (!opts.linkConnected) return false
  return remotePointerLaserOnForMode(opts.mode)
}
