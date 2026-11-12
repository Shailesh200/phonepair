import { createStore } from '../core/bus.ts'

/** Bumps when host/guest remember storage is saved or forgotten. */
export const rememberStorageEpoch = createStore(0)

export function notifyRememberStorageChanged() {
  rememberStorageEpoch.set((n) => n + 1)
}
