import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBrowserKeepAwake } from './keepAwakeRun.ts'

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('keep-awake visibility listener', () => {
  it('re-acquires the wake lock after detach and attach, once per visibilitychange', async () => {
    const calls: string[] = []
    const listeners = new Set<() => void>()
    const prevDoc = globalThis.document
    const nav = globalThis.navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } | null }
    const prevLock = nav.wakeLock
    const doc = {
      hidden: false,
      body: { appendChild() {} },
      pictureInPictureElement: null as HTMLVideoElement | null,
      createElement() {
        const el = {
          paused: false,
          style: {} as { cssText?: string },
          src: '',
          srcObject: null as MediaStream | null,
          setAttribute() {},
          addEventListener() {},
          removeAttribute() {},
          pause() { el.paused = true },
          play() { el.paused = false; return Promise.resolve() },
          remove() {},
        }
        return el
      },
      addEventListener(_type: string, fn: () => void) { listeners.add(fn) },
      removeEventListener(_type: string, fn: () => void) { listeners.delete(fn) },
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc })
    const wakeLock = {
      request: async (type: 'screen') => {
        calls.push(type)
        return { release: async () => {}, addEventListener() {} }
      },
    }
    try { nav.wakeLock = wakeLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: wakeLock }) }

    const fire = () => { for (const fn of listeners) fn() }

    try {
      const awake = createBrowserKeepAwake({
        helperConnected: () => false,
        sendHelper() {},
        publish() {},
      })
      awake.attach()
      awake.attach()
      assert.equal(listeners.size, 1)
      await awake.start('1m')
      assert.ok(calls.length >= 1)

      doc.hidden = true
      awake.detach()
      awake.detach()
      assert.equal(listeners.size, 0)
      const whileDetached = calls.length
      fire()
      await flush()
      assert.equal(calls.length, whileDetached)

      awake.attach()
      awake.attach()
      assert.equal(listeners.size, 1)
      doc.hidden = false
      await awake.start('1m')
      const beforeShow = calls.length
      fire()
      await flush()
      await flush()
      assert.equal(calls.length, beforeShow + 1)
      assert.ok(calls.every((type) => type === 'screen'))
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: prevDoc })
      try { nav.wakeLock = prevLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: prevLock }) }
    }
  })

  it('does not stay paused when show is waiting on a wake lock or play()', async () => {
    const statuses: (string | null)[] = []
    const listeners = new Set<() => void>()
    const prevDoc = globalThis.document
    const nav = globalThis.navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } | null }
    const prevLock = nav.wakeLock
    const doc = {
      hidden: true,
      body: { appendChild() {} },
      pictureInPictureElement: null as HTMLVideoElement | null,
      createElement() {
        return {
          paused: true,
          style: {} as { cssText?: string },
          src: '',
          srcObject: null as MediaStream | null,
          setAttribute() {},
          addEventListener() {},
          removeAttribute() {},
          pause() {},
          play() { return new Promise(() => {}) },
          remove() {},
        }
      },
      addEventListener(_type: string, fn: () => void) { listeners.add(fn) },
      removeEventListener(_type: string, fn: () => void) { listeners.delete(fn) },
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc })
    nav.wakeLock = { request: () => new Promise(() => {}) }
    try {
      const awake = createBrowserKeepAwake({
        helperConnected: () => false,
        sendHelper() {},
        publish(state) { statuses.push(state.status) },
      })
      awake.attach()
      void awake.start('1m')
      await flush()
      assert.equal(statuses.at(-1), 'Paused, tab hidden')
      doc.hidden = false
      for (const fn of listeners) fn()
      assert.notEqual(statuses.at(-1), 'Paused, tab hidden')
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: prevDoc })
      try { nav.wakeLock = prevLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: prevLock }) }
    }
  })

  it('plays video only when the wake lock is missing, fails, or is released', async () => {
    const prevDoc = globalThis.document
    const nav = globalThis.navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } | null }
    const prevLock = nav.wakeLock
    let plays = 0
    let onRelease: (() => void) | null = null
    const doc = {
      hidden: false,
      body: { appendChild() {} },
      pictureInPictureElement: null as HTMLVideoElement | null,
      createElement() {
        const el = {
          paused: true,
          style: {} as { cssText?: string },
          src: '',
          srcObject: null as MediaStream | null,
          setAttribute() {},
          addEventListener() {},
          removeAttribute() {},
          pause() { el.paused = true },
          play() { plays += 1; el.paused = false; return Promise.resolve() },
          remove() {},
        }
        return el
      },
      addEventListener() {},
      removeEventListener() {},
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc })
    const host = { helperConnected: () => false, sendHelper() {}, publish() {} }
    try {
      nav.wakeLock = {
        request: async () => ({
          release: async () => {},
          addEventListener(_type: string, fn: () => void) { onRelease = fn },
        }),
      }
      const held = createBrowserKeepAwake(host)
      await held.start('1m')
      assert.equal(plays, 0)
      onRelease?.()
      await flush()
      await flush()
      assert.equal(plays, 1)

      plays = 0
      nav.wakeLock = { request: async () => { throw new Error('denied') } }
      const denied = createBrowserKeepAwake(host)
      await denied.start('1m')
      assert.equal(plays, 1)
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: prevDoc })
      try { nav.wakeLock = prevLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: prevLock }) }
    }
  })
})
