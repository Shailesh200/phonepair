import { newListenId, newPhoneId, newPhoneKey, keyToB64, keyFromB64 } from './ids'
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
    const phones = readJson<SavedPhone[]>(HOST_PHONES_KEY)
    if (!listenId || !Array.isArray(phones) || !phones.length) return null
    return { listenId, phones }
  } catch {
    return null
  }
}

export function saveHostStore(store: HostStore | null) {
  try {
    if (!store?.listenId || !store.phones.length) {
      localStorage.removeItem(HOST_LISTEN_KEY)
      localStorage.removeItem(HOST_PHONES_KEY)
      return
    }
    localStorage.setItem(HOST_LISTEN_KEY, store.listenId)
    localStorage.setItem(HOST_PHONES_KEY, JSON.stringify(store.phones))
  } catch {}
}

export function loadGuestStore(): GuestStore {
  const laptops = readJson<SavedLaptop[]>(GUEST_LAPTOPS_KEY)
  if (!laptops?.length) return { laptops: [] }
  return { laptops }
}

export function saveGuestStore(store: GuestStore) {
  if (!store.laptops.length) writeJson(GUEST_LAPTOPS_KEY, null)
  else writeJson(GUEST_LAPTOPS_KEY, store.laptops)
}

export function hostHasPhones(store: HostStore | null): boolean {
  return !!store?.phones?.length
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
