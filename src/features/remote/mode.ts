export const REMOTE_MODES = ['trackpad', 'clicker', 'pointer'] as const
export type RemoteMode = (typeof REMOTE_MODES)[number]

/** localStorage key for the phone remote's selected mode. */
export const REMOTE_MODE_KEY = 'phonepair.remote.mode'

const listeners = new Set<() => void>()
let current: RemoteMode = 'trackpad'
let hydrated = false

export function isRemoteMode(value: unknown): value is RemoteMode {
  return value === 'trackpad' || value === 'clicker' || value === 'pointer'
}

function memory(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function readRemoteMode(storage: Storage | null = memory()): RemoteMode {
  try {
    const raw = storage?.getItem(REMOTE_MODE_KEY)
    return isRemoteMode(raw) ? raw : 'trackpad'
  } catch {
    return 'trackpad'
  }
}

export function writeRemoteMode(mode: RemoteMode, storage: Storage | null = memory()) {
  try {
    storage?.setItem(REMOTE_MODE_KEY, mode)
  } catch {
    /* storage blocked */
  }
}

export function subscribeRemoteMode(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getRemoteMode(): RemoteMode {
  if (!hydrated) {
    hydrated = true
    current = readRemoteMode()
  }
  return current
}

function publish(next: RemoteMode) {
  hydrated = true
  if (current === next) return current
  current = next
  listeners.forEach((fn) => fn())
  return current
}

/** Switch mode and persist it. Trackpad, clicker, and pointer share this state. */
export function setRemoteMode(mode: RemoteMode, storage: Storage | null = memory()): RemoteMode {
  if (!isRemoteMode(mode)) return getRemoteMode()
  writeRemoteMode(mode, storage)
  return publish(mode)
}

/** Read the saved mode again, as a fresh page load does. */
export function restoreRemoteMode(storage: Storage | null = memory()): RemoteMode {
  return publish(readRemoteMode(storage))
}
