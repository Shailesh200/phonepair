/**
 * Class hooks from the single-screen remote spec.
 * A later visual pass can restyle these names without changing the structure.
 */
export const remoteStyles = {
  page: 'pg remote pp-remote',
  badge: 'tag ok',
  mode: 'seg remote-mode',
  pad: 'pp-remote-pad pad-area',
  hint: 'pad-hint',
  finger: 'touch-dot',
  scroll: 'pad-scroll',
  scrollOn: 'on',
  clicks: 'two clicks',
  left: 'btn ghost big',
  right: 'btn ghost big',
  clicker: 'pp-remote-clicker',
  prev: 'btn soft big',
  next: 'btn big',
  laser: 'pp-remote-laser',
  keyboard: 'btn ghost big kb-btn',
  form: 'kb-form',
  input: 'kb',
} as const

export function remotePageClass(className?: string) {
  return className ? `${remoteStyles.page} ${className}` : remoteStyles.page
}

export function remoteScrollClass(on: boolean) {
  return on ? `${remoteStyles.scroll} ${remoteStyles.scrollOn}` : remoteStyles.scroll
}
