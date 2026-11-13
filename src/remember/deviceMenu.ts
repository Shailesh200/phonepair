/** Saved-device overflow menu. Clipboard and link recovery stay out of this file. */

export type DeviceMenuAction = 'connect' | 'disconnect' | 'edit' | 'forget'

export type DeviceMenuHandlers = {
  onConnect?: () => void
  onDisconnect?: () => void
  onEdit?: () => void
  onForget?: () => void
}

/** Connected cards offer Disconnect. Everyone else offers Connect. Edit and Forget are always there. */
export function deviceMenuActions(connected: boolean): DeviceMenuAction[] {
  return connected ? ['disconnect', 'edit', 'forget'] : ['connect', 'edit', 'forget']
}

export function deviceMenuLabel(action: DeviceMenuAction): string {
  if (action === 'connect') return 'Connect'
  if (action === 'disconnect') return 'Disconnect'
  if (action === 'edit') return 'Edit'
  return 'Forget'
}

export function deviceMenuAfterToggle(open: boolean): boolean {
  return !open
}

/** Escape, an outside click, and choosing an item all close the menu. */
export function deviceMenuDismissHandlers(opts: {
  contains: (node: EventTarget | null) => boolean
  close: () => void
}) {
  return {
    keydown(event: { key: string }) {
      if (event.key === 'Escape') opts.close()
    },
    pointerdown(event: { target: EventTarget | null }) {
      if (!opts.contains(event.target)) opts.close()
    },
  }
}

export function chooseDeviceMenuItem(action: DeviceMenuAction, handlers: DeviceMenuHandlers, close: () => void) {
  close()
  if (action === 'connect') handlers.onConnect?.()
  else if (action === 'disconnect') handlers.onDisconnect?.()
  else if (action === 'edit') handlers.onEdit?.()
  else handlers.onForget?.()
}

export function deviceMenuIndexAfterKey(index: number, count: number, key: string): number {
  if (count <= 0) return 0
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown') return (index + 1) % count
  if (key === 'ArrowUp') return (index - 1 + count) % count
  return index
}

/** Place a fixed menu so it stays inside the viewport, including a 360px-wide phone. */
export function deviceMenuPlacement(opts: {
  viewportWidth: number
  viewportHeight: number
  anchorTop: number
  anchorBottom: number
  anchorRight: number
  menuWidth: number
  menuHeight: number
}): { top: number; left: number; width: number; fits: boolean } {
  const width = Math.min(opts.menuWidth, Math.max(0, opts.viewportWidth))
  let left = opts.anchorRight - width
  if (left < 0) left = 0
  if (left + width > opts.viewportWidth) left = Math.max(0, opts.viewportWidth - width)
  const spaceBelow = opts.viewportHeight - opts.anchorBottom
  const top = spaceBelow >= opts.menuHeight || opts.anchorTop < opts.menuHeight
    ? Math.max(0, opts.anchorBottom)
    : Math.max(0, opts.anchorTop - opts.menuHeight)
  const fits = width <= opts.viewportWidth
    && left >= 0
    && left + width <= opts.viewportWidth
    && top >= 0
    && top + opts.menuHeight <= opts.viewportHeight
  return { top, left, width, fits }
}

/** This saved laptop is the one the phone session is on. */
export function savedLaptopConnected(opts: {
  connected: boolean
  rememberListenId?: string
  sessionPaired: boolean
  listenId: string
  savedCount: number
}): boolean {
  if (!opts.connected) return false
  if (opts.rememberListenId && opts.rememberListenId === opts.listenId) return true
  if (opts.sessionPaired && !opts.rememberListenId && opts.savedCount === 1) return true
  return false
}

/** This saved phone is the one the laptop is talking to. Match the live remote name. */
export function savedPhoneConnected(opts: {
  connected: boolean
  remoteName: string
  phoneName: string
  label: string
}): boolean {
  if (!opts.connected) return false
  const remote = opts.remoteName.trim()
  if (!remote) return false
  return remote === opts.phoneName.trim() || remote === opts.label.trim()
}
