import type { RemoteMode } from './mode'

/**
 * Plain class hooks for the merged remote.
 * A later design can replace these names; Remote keeps the same structure.
 */
export const remoteStyles = {
  page: 'pg remote',
  badge: 'tag ok',
  switcher: 'seg',
  tabOn: 'on',
  clickerHelp: 'clicker-help card',
  pad: 'pad-area',
  hint: 'pad-hint',
  finger: 'touch-dot',
  scroll: 'pad-scroll',
  scrollOn: 'on',
  clicks: 'two clicks',
  left: 'btn ghost big',
  right: 'btn ghost big',
  nav: 'two nav2',
  navTall: 'tall',
  prev: 'btn soft big',
  next: 'btn big',
  keyboard: 'btn ghost big kb-btn',
  form: 'kb-form',
  input: 'kb',
} as const

export function remotePageClass(className?: string) {
  return className ? `${remoteStyles.page} ${className}` : remoteStyles.page
}

export function remoteNavClass(mode: RemoteMode) {
  return mode === 'clicker' ? `${remoteStyles.nav} ${remoteStyles.navTall}` : remoteStyles.nav
}

export function remoteTabClass(on: boolean) {
  return on ? remoteStyles.tabOn : ''
}

export function remoteScrollClass(on: boolean) {
  return on ? `${remoteStyles.scroll} ${remoteStyles.scrollOn}` : remoteStyles.scroll
}

export function modeLabel(mode: RemoteMode) {
  if (mode === 'trackpad') return 'Trackpad'
  if (mode === 'clicker') return 'Clicker'
  return 'Pointer'
}
