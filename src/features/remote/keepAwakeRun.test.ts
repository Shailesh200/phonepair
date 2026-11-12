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
})
