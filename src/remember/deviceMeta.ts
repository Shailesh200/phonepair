/** Local display names and favourites for connected devices. localStorage only. */

export const DEVICE_META_KEY = 'pp.deviceMeta.v1'
export const DEVICE_NAME_MAX = 64

export type DeviceMeta = { name?: string; fav?: boolean }
export type DeviceMetaStore = { v: 1; devices: Record<string, DeviceMeta> }

const listeners = new Set<() => void>()
let revision = 0

function blankDevices(): Record<string, DeviceMeta> {
  return Object.create(null) as Record<string, DeviceMeta>
}

function blank(): DeviceMetaStore {
  return { v: 1, devices: blankDevices() }
}

function safeId(id: unknown): id is string {
  return typeof id === 'string'
    && id.length > 0
    && id !== '__proto__'
    && id !== 'constructor'
    && id !== 'prototype'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function browserStorage(): Storage | null {
  try {
    const ls = globalThis.localStorage
    if (!ls) return null
    return ls
  } catch {
    return null
  }
}

/** Trim and cap a display name. Empty means "use the default name". */
export function normalizeDeviceName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const chars = Array.from(trimmed)
  if (chars.length <= DEVICE_NAME_MAX) return trimmed
  return chars.slice(0, DEVICE_NAME_MAX).join('').trim()
}

function sanitizeEntry(value: unknown): DeviceMeta | null {
  if (!isRecord(value)) return null
  const entry: DeviceMeta = {}
  const name = normalizeDeviceName(value.name)
  if (name) entry.name = name
  if (value.fav === true) entry.fav = true
  if (!entry.name && entry.fav !== true) return null
  return entry
}

export function deviceMetaRevision(): number {
  return revision
}

export function subscribeDeviceMeta(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notify(): void {
  revision += 1
  for (const listener of [...listeners]) listener()
}

export function getDeviceMetaStore(): DeviceMetaStore {
  const ls = browserStorage()
  if (!ls) return blank()
  let raw: string | null
  try {
    raw = ls.getItem(DEVICE_META_KEY)
  } catch {
    return blank()
  }
  if (raw == null || raw === '') return blank()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return blank()
  }
  if (!isRecord(parsed) || parsed.v !== 1 || !isRecord(parsed.devices)) return blank()
  const devices = blankDevices()
  for (const [id, value] of Object.entries(parsed.devices)) {
    if (!safeId(id)) continue
    const entry = sanitizeEntry(value)
    if (entry) devices[id] = entry
  }
  return { v: 1, devices }
}

export function getDeviceMeta(id: string): DeviceMeta {
  if (!safeId(id)) return {}
  const entry = getDeviceMetaStore().devices[id]
  if (!entry) return {}
  const copy: DeviceMeta = {}
  if (entry.name) copy.name = entry.name
  if (entry.fav === true) copy.fav = true
  return copy
}

export function deviceLabel(id: string, fallback: string): string {
  const name = getDeviceMeta(id).name
  if (name) return name
  return typeof fallback === 'string' ? fallback : ''
}

function persist(store: DeviceMetaStore): void {
  const ls = browserStorage()
  if (!ls) return
  try {
    const devices = blankDevices()
    for (const [id, value] of Object.entries(store.devices)) {
      if (!safeId(id)) continue
      const entry = sanitizeEntry(value)
      if (entry) devices[id] = entry
    }
    if (!Object.keys(devices).length) ls.removeItem(DEVICE_META_KEY)
    else ls.setItem(DEVICE_META_KEY, JSON.stringify({ v: 1, devices }))
  } catch {
    // Private mode, quota, or storage disabled.
  }
}

function mutate(update: (store: DeviceMetaStore) => void): void {
  const store = getDeviceMetaStore()
  update(store)
  persist(store)
  notify()
}

export function renameDevice(id: string, name: string): void {
  if (!safeId(id)) return
  const nextName = normalizeDeviceName(name)
  mutate((store) => {
    const prev = store.devices[id]
    const entry: DeviceMeta = {}
    if (nextName) entry.name = nextName
    if (prev?.fav === true) entry.fav = true
    if (!entry.name && entry.fav !== true) delete store.devices[id]
    else store.devices[id] = entry
  })
}

export function toggleFavourite(id: string): boolean {
  if (!safeId(id)) return false
  mutate((store) => {
    const prev = store.devices[id]
    const entry: DeviceMeta = {}
    if (prev?.name) entry.name = prev.name
    if (prev?.fav !== true) entry.fav = true
    if (!entry.name && entry.fav !== true) delete store.devices[id]
    else store.devices[id] = entry
  })
  return getDeviceMeta(id).fav === true
}

/** Clear one device, or every device when called with no id. */
export function clearDeviceMeta(id?: string): void {
  if (id !== undefined) {
    if (!safeId(id)) return
    const store = getDeviceMetaStore()
    if (!store.devices[id]) return
    delete store.devices[id]
    persist(store)
    notify()
    return
  }
  persist(blank())
  notify()
}

/** Favourites first. Relative order is unchanged within each group. */
export function sortFavouritesFirst<T>(items: readonly T[], isFavourite: (item: T) => boolean): T[] {
  return items
    .map((item, index) => ({ item, index, fav: isFavourite(item) === true }))
    .sort((a, b) => {
      if (a.fav === b.fav) return a.index - b.index
      return a.fav ? -1 : 1
    })
    .map(({ item }) => item)
}
