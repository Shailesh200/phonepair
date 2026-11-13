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
