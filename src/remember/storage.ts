import { newListenId, newPhoneId, newPhoneKey, keyToB64, keyFromB64 } from './ids'
import { notifyRememberStorageChanged } from './storageNotify'
import { friendlyDeviceName } from './deviceName'
import type { GuestStore, HostStore, SavedLaptop, SavedPhone } from './records'
import {
  forgetGuestLaptopRecord,
  forgetHostPhoneRecord,
  upsertGuestLaptop,
} from './records'

export type { GuestStore, HostStore, SavedLaptop, SavedPhone } from './records'

const HOST_LISTEN_KEY = 'pp-r-listen'
const HOST_PHONES_KEY = 'pp-r-phones'
const GUEST_LAPTOPS_KEY = 'pp-r-laptops'

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

export function loadHostStore(): HostStore | null {
  try {
    const listenId = localStorage.getItem(HOST_LISTEN_KEY)
    if (!listenId) return null
    const phones = readJson<SavedPhone[]>(HOST_PHONES_KEY)
    if (!Array.isArray(phones) || !phones.length) return null
    return { listenId, phones }
  } catch {
    return null
  }
}

export function saveHostStore(store: HostStore | null) {
  try {
    if (!store?.listenId) {
      localStorage.removeItem(HOST_LISTEN_KEY)
      localStorage.removeItem(HOST_PHONES_KEY)
      notifyRememberStorageChanged()
      return
    }
    localStorage.setItem(HOST_LISTEN_KEY, store.listenId)
    if (!store.phones.length) localStorage.removeItem(HOST_PHONES_KEY)
    else localStorage.setItem(HOST_PHONES_KEY, JSON.stringify(store.phones))
    notifyRememberStorageChanged()
  } catch {}
}

export function loadGuestStore(): GuestStore {
  const laptops = readJson<SavedLaptop[]>(GUEST_LAPTOPS_KEY)
  if (!laptops?.length) return { laptops: [] }
  if (laptops.length > 1) return { laptops: [laptops[laptops.length - 1]!] }
  return { laptops }
}

export function saveGuestStore(store: GuestStore) {
  if (!store.laptops.length) writeJson(GUEST_LAPTOPS_KEY, null)
  else writeJson(GUEST_LAPTOPS_KEY, store.laptops)
  notifyRememberStorageChanged()
}

export function hostHasPhones(store: HostStore | null): boolean {
  return !!store?.phones?.length
}

export function hostRememberListenActive(): boolean {
  try {
    return !!localStorage.getItem(HOST_LISTEN_KEY)
  } catch {
    return false
  }
}

export { forgetHostPhoneRecord, forgetGuestLaptopRecord }

export function upsertHostPhone(
  store: HostStore | null,
  entry: SavedPhone,
): HostStore {
  const listenId = store?.listenId ?? newListenId()
  const phones = [...(store?.phones ?? []).filter((p) => p.id !== entry.id), entry]
  return { listenId, phones }
}

export { upsertGuestLaptop }

export function createRememberGrant(existingListenId?: string) {
  return {
    listenId: existingListenId ?? newListenId(),
    phoneId: newPhoneId(),
    key: newPhoneKey(),
    laptopName: friendlyDeviceName(),
  }
}

export function phoneKeyBytes(entry: { key: string }): Uint8Array {
  return keyFromB64(entry.key)
}

export function phoneKeyStored(key: Uint8Array): string {
  return keyToB64(key)
}
