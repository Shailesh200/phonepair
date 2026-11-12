import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  DEVICE_META_KEY,
  DEVICE_NAME_MAX,
  clearDeviceMeta,
  deviceLabel,
  getDeviceMeta,
  normalizeDeviceName,
  renameDevice,
  sortFavouritesFirst,
  toggleFavourite,
} from './deviceMeta.ts'

type MemStorage = Storage & { _data: Map<string, string> }

function memoryStorage(): MemStorage {
  const data = new Map<string, string>()
  return {
    _data: data,
    getItem(key: string) { return data.has(key) ? data.get(key)! : null },
    setItem(key: string, value: string) { data.set(String(key), String(value)) },
    removeItem(key: string) { data.delete(key) },
    clear() { data.clear() },
    key(index: number) { return [...data.keys()][index] ?? null },
    get length() { return data.size },
  }
}

function install(storage: Storage) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
}

function readStored(): unknown {
  const raw = globalThis.localStorage.getItem(DEVICE_META_KEY)
  return raw == null ? null : JSON.parse(raw) as unknown
}

describe('device meta store', { concurrency: false }, () => {
  let previous: PropertyDescriptor | undefined

  beforeEach(() => {
    previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    install(memoryStorage())
  })

  afterEach(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('uses the versioned key and an empty store when nothing is saved', () => {
    assert.equal(DEVICE_META_KEY, 'pp.deviceMeta.v1')
    assert.deepEqual(getDeviceMeta('phone-1'), {})
    assert.equal(deviceLabel('phone-1', 'Chrome on Mac'), 'Chrome on Mac')
    assert.equal(globalThis.localStorage.getItem(DEVICE_META_KEY), null)
  })

  it('renames, trims, caps, and resets an empty name to the default', () => {
    renameDevice('phone-1', '  Kitchen iPad  ')
    assert.deepEqual(getDeviceMeta('phone-1'), { name: 'Kitchen iPad' })
    assert.equal(deviceLabel('phone-1', 'Chrome on Mac'), 'Kitchen iPad')
    assert.deepEqual(readStored(), { v: 1, devices: { 'phone-1': { name: 'Kitchen iPad' } } })

    const long = `${'a'.repeat(DEVICE_NAME_MAX)}TAIL`
    renameDevice('phone-1', `  ${long}  `)
    assert.equal(getDeviceMeta('phone-1').name, 'a'.repeat(DEVICE_NAME_MAX))
    assert.equal(Array.from(getDeviceMeta('phone-1').name ?? '').length, DEVICE_NAME_MAX)

    const emoji = '😀'.repeat(DEVICE_NAME_MAX + 3)
    renameDevice('phone-1', emoji)
    assert.equal(getDeviceMeta('phone-1').name, '😀'.repeat(DEVICE_NAME_MAX))

    renameDevice('phone-1', '   ')
    assert.deepEqual(getDeviceMeta('phone-1'), {})
    assert.equal(deviceLabel('phone-1', 'Chrome on Mac'), 'Chrome on Mac')
    assert.equal(globalThis.localStorage.getItem(DEVICE_META_KEY), null)
  })

  it('toggles favourite without dropping a custom name, and drops an empty entry', () => {
    assert.equal(toggleFavourite('phone-1'), true)
    assert.deepEqual(getDeviceMeta('phone-1'), { fav: true })
    renameDevice('phone-1', 'Desk')
    assert.deepEqual(getDeviceMeta('phone-1'), { name: 'Desk', fav: true })
    assert.equal(toggleFavourite('phone-1'), false)
    assert.deepEqual(getDeviceMeta('phone-1'), { name: 'Desk' })
    clearDeviceMeta('phone-1')
    renameDevice('phone-1', '   ')
    toggleFavourite('phone-1')
    assert.equal(toggleFavourite('phone-1'), false)
    assert.equal(globalThis.localStorage.getItem(DEVICE_META_KEY), null)
  })

  it('clears one device or the whole store', () => {
    renameDevice('a', 'Alpha')
    toggleFavourite('b')
    clearDeviceMeta('a')
    assert.deepEqual(getDeviceMeta('a'), {})
    assert.deepEqual(getDeviceMeta('b'), { fav: true })
    clearDeviceMeta()
    assert.deepEqual(getDeviceMeta('b'), {})
    assert.equal(globalThis.localStorage.getItem(DEVICE_META_KEY), null)
    clearDeviceMeta('')
    clearDeviceMeta('__proto__')
    assert.equal(({} as { name?: string }).name, undefined)
  })

  it('ignores missing, corrupt, wrong-shape, and wrong-version data', () => {
    const cases = [
      '',
      '   ',
      '{',
      'null',
      '[]',
      '"hello"',
      '1',
      JSON.stringify({ devices: { a: { name: 'Z' } } }),
      JSON.stringify({ v: '1', devices: { a: { name: 'Z' } } }),
      JSON.stringify({ v: 2, devices: { a: { name: 'Z', fav: true } } }),
      JSON.stringify({ v: 0, devices: {} }),
      JSON.stringify({ v: 1 }),
      JSON.stringify({ v: 1, devices: null }),
      JSON.stringify({ v: 1, devices: [] }),
      JSON.stringify({ v: 1, devices: 'nope' }),
      JSON.stringify({ v: 1, devices: { a: null, b: [], c: { name: 4, fav: 'yes' }, d: { name: '  OK  ', fav: false, extra: 1 } } }),
    ]
    for (const raw of cases) {
      globalThis.localStorage.setItem(DEVICE_META_KEY, raw)
      assert.doesNotThrow(() => getDeviceMeta('d'))
      assert.deepEqual(getDeviceMeta('a'), {})
    }
    globalThis.localStorage.setItem(DEVICE_META_KEY, JSON.stringify({
      v: 1,
      devices: { a: null, b: [], c: { name: 4, fav: 'yes' }, d: { name: '  OK  ', fav: false, extra: 1 } },
    }))
    assert.deepEqual(getDeviceMeta('a'), {})
    assert.deepEqual(getDeviceMeta('c'), {})
    assert.deepEqual(getDeviceMeta('d'), { name: 'OK' })

    globalThis.localStorage.setItem(DEVICE_META_KEY, '{not json')
    assert.deepEqual(getDeviceMeta('d'), {})
    renameDevice('d', 'Recovered')
    assert.deepEqual(readStored(), { v: 1, devices: { d: { name: 'Recovered' } } })
  })

  it('does not throw when localStorage is missing or throws', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    assert.doesNotThrow(() => {
      assert.deepEqual(getDeviceMeta('a'), {})
      renameDevice('a', 'Nope')
      toggleFavourite('a')
      clearDeviceMeta('a')
      clearDeviceMeta()
    })
    assert.deepEqual(getDeviceMeta('a'), {})

    install(memoryStorage())
    renameDevice('a', 'Kept')
    const throwing: Storage = {
      getItem() { throw new Error('denied') },
      setItem() { throw new Error('denied') },
      removeItem() { throw new Error('denied') },
      clear() { throw new Error('denied') },
      key() { throw new Error('denied') },
      get length() { throw new Error('denied') },
    }
    install(throwing)
    assert.doesNotThrow(() => {
      assert.deepEqual(getDeviceMeta('a'), {})
      renameDevice('a', 'Other')
      toggleFavourite('a')
      clearDeviceMeta('a')
      clearDeviceMeta()
    })

    const readOnly = memoryStorage()
    readOnly.setItem(DEVICE_META_KEY, JSON.stringify({ v: 1, devices: { a: { name: 'Kept', fav: true } } }))
    readOnly.setItem = () => { throw new Error('quota') }
    readOnly.removeItem = () => { throw new Error('quota') }
    install(readOnly)
    assert.doesNotThrow(() => {
      renameDevice('a', 'Changed')
      toggleFavourite('a')
      clearDeviceMeta()
    })
    assert.deepEqual(getDeviceMeta('a'), { name: 'Kept', fav: true })
  })

  it('caps and trims without keeping surrounding whitespace', () => {
    assert.equal(normalizeDeviceName('   '), '')
    assert.equal(normalizeDeviceName(12), '')
    assert.equal(normalizeDeviceName('  hi  '), 'hi')
  })
})

describe('sortFavouritesFirst', () => {
  it('puts favourites first and keeps relative order otherwise', () => {
    const items = [
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'd' },
      { id: 'e' },
    ]
    const before = items.map((item) => item.id)
    const fav = new Set(['c', 'a'])
    const sorted = sortFavouritesFirst(items, (item) => fav.has(item.id))
    assert.deepEqual(items.map((item) => item.id), before)
    assert.deepEqual(sorted.map((item) => item.id), ['a', 'c', 'b', 'd', 'e'])
    assert.deepEqual(sortFavouritesFirst(items, () => false).map((item) => item.id), before)
    assert.deepEqual(sortFavouritesFirst(items, () => true).map((item) => item.id), before)
    assert.deepEqual(sortFavouritesFirst([], () => true), [])
  })
})
