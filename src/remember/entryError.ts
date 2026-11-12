import { createStore } from '../core/bus.ts'

export type RememberEntryError = { message: string; listenId?: string }

export const rememberEntryError = createStore<RememberEntryError | null>(null)
