export type SavedPhone = { id: string; name: string; key: string }
export type HostStore = { listenId: string; phones: SavedPhone[] }

export type SavedLaptop = { listenId: string; phoneId: string; name: string; key: string }
export type GuestStore = { laptops: SavedLaptop[] }

export function forgetHostPhoneRecord(store: HostStore, phoneId: string): { next: HostStore | null; stopListen: boolean } {
  const phones = store.phones.filter((p) => p.id !== phoneId)
  if (!phones.length) return { next: null, stopListen: true }
  return { next: { ...store, phones }, stopListen: false }
}

export function forgetGuestLaptopRecord(store: GuestStore, listenId: string): GuestStore {
  return { laptops: store.laptops.filter((l) => l.listenId !== listenId) }
}

export function upsertGuestLaptop(store: GuestStore, entry: SavedLaptop): GuestStore {
  const laptops = [...store.laptops.filter((l) => l.listenId !== entry.listenId), entry]
  return { laptops }
}
