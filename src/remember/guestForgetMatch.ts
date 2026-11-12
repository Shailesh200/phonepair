import type { GuestStore } from './records.ts'

export function guestForgetMatchesSavedLaptop(
  store: GuestStore,
  listenId: string,
  phoneId: string,
): boolean {
  const lap = store.laptops.find((l) => l.listenId === listenId)
  return !!lap && lap.phoneId === phoneId
}
