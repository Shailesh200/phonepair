import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { WAKE_LOCK_HIDE_SETTLE_MS, createBrowserKeepAwake } from './keepAwakeRun.ts'

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

  it('keeps On (screen awake) while a visible tab re-acquires the wake lock', async () => {
    const statuses: (string | null)[] = []
    const listeners = new Set<() => void>()
    const prevDoc = globalThis.document
    const nav = globalThis.navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } | null }
    const prevLock = nav.wakeLock
    let requests = 0
    let release: (() => void) | null = null
    let resolveAgain: ((sentinel: unknown) => void) | null = null
    const doc = {
      hidden: false,
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
    nav.wakeLock = {
      request: () => {
        requests += 1
        if (requests === 1) {
          return Promise.resolve({
            release: async () => {},
            addEventListener(_type: string, fn: () => void) { release = fn },
          })
        }
        return new Promise((resolve) => { resolveAgain = resolve })
      },
    }
    try {
      const awake = createBrowserKeepAwake({
        helperConnected: () => false,
        sendHelper() {},
        publish(state) { statuses.push(state.status) },
      })
      awake.attach()
      await awake.start('1m')
      assert.equal(statuses.at(-1), 'On (screen awake)')
      doc.hidden = true
      for (const fn of listeners) fn()
      release?.()
      assert.equal(statuses.at(-1), 'Paused, tab hidden')
      const during = statuses.length
      doc.hidden = false
      for (const fn of listeners) fn()
      assert.equal(statuses.at(-1), 'On (screen awake)')
      assert.equal(statuses.slice(during).includes('Not supported'), false)
      resolveAgain?.({ release: async () => {}, addEventListener() {} })
      await flush()
      await flush()
      assert.equal(statuses.at(-1), 'On (screen awake)')
      assert.equal(statuses.includes('Not supported'), false)
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: prevDoc })
      try { nav.wakeLock = prevLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: prevLock }) }
    }
  })

  it('shows Helper not running when the helper quits, and stays blank if it was already off', () => {
    let connected = true
    const awake = createBrowserKeepAwake({
      helperConnected: () => connected,
      sendHelper() {},
      publish() {},
    })
    awake.noteHelperReport({ on: true, interval: '1m' })
    assert.equal(awake.view().status, 'On (real mouse)')
    assert.equal(awake.view().on, true)
    connected = false
    awake.onHelperDisconnected()
    assert.equal(awake.view().status, 'Helper not running')
    assert.equal(awake.view().on, false)
    assert.equal(awake.view().mode, 'none')

    awake.stop()
    assert.equal(awake.view().status, null)
    awake.noteHelperReport({ on: true, interval: '30s' })
    awake.stop()
    connected = false
    awake.onHelperDisconnected()
    assert.equal(awake.view().status, null)
  })

  it('opens picture-in-picture on the first click, after play()', async () => {
    const order: string[] = []
    const prevDoc = globalThis.document
    const nav = globalThis.navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } | null }
    const prevLock = nav.wakeLock
    const video = {
      paused: true,
      style: {} as { cssText?: string },
      src: '',
      srcObject: null as MediaStream | null,
      setAttribute() {},
      addEventListener() {},
      removeAttribute() {},
      pause() { video.paused = true },
      play() { order.push('play'); video.paused = false; return Promise.resolve() },
      requestPictureInPicture() { order.push('pip'); return Promise.resolve() },
      remove() {},
    }
    const doc = {
      hidden: false,
      pictureInPictureEnabled: true,
      pictureInPictureElement: null as typeof video | null,
      body: { appendChild() {} },
      createElement() { return video },
      addEventListener() {},
      removeEventListener() {},
      exitPictureInPicture() { order.push('exit'); return Promise.resolve() },
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc })
    nav.wakeLock = {
      request: async () => ({ release: async () => {}, addEventListener() {} }),
    }
    try {
      const awake = createBrowserKeepAwake({
        helperConnected: () => false,
        sendHelper() {},
        publish() {},
      })
      await awake.start('1m')
      assert.deepEqual(order, [])
      await awake.pip()
      assert.deepEqual(order, ['play', 'pip'])

      order.length = 0
      doc.pictureInPictureElement = video
      await awake.pip()
      assert.deepEqual(order, ['exit'])

      order.length = 0
      doc.pictureInPictureElement = null
      doc.pictureInPictureEnabled = false
      await awake.pip()
      assert.deepEqual(order, [])

      doc.pictureInPictureEnabled = true
      const request = video.requestPictureInPicture
      delete (video as { requestPictureInPicture?: () => Promise<void> }).requestPictureInPicture
      await awake.pip()
      assert.deepEqual(order, [])
      video.requestPictureInPicture = () => { order.push('pip'); return Promise.reject(new Error('refused')) }
      await awake.pip()
      assert.deepEqual(order, ['play', 'pip'])
      video.requestPictureInPicture = request
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: prevDoc })
      try { nav.wakeLock = prevLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: prevLock }) }
    }
  })

  it('plays video only when the wake lock is missing, fails, or cannot be re-acquired', async () => {
    const prevDoc = globalThis.document
    const nav = globalThis.navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } | null }
    const prevLock = nav.wakeLock
    let plays = 0
    let onRelease: (() => void) | null = null
    let requests = 0
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
    let held: ReturnType<typeof createBrowserKeepAwake> | null = null
    let denied: ReturnType<typeof createBrowserKeepAwake> | null = null
    try {
      nav.wakeLock = {
        request: async () => {
          requests += 1
          if (requests > 1) throw new Error('dropped')
          return {
            release: async () => {},
            addEventListener(_type: string, fn: () => void) { onRelease = fn },
          }
        },
      }
      held = createBrowserKeepAwake(host)
      await held.start('1m')
      assert.equal(plays, 0)
      onRelease?.()
      await flush()
      assert.equal(plays, 0)
      const started = Date.now()
      while (plays < 1 && Date.now() - started < 500) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      assert.equal(requests, 2)
      assert.equal(plays, 1)

      plays = 0
      held.stop()
      nav.wakeLock = { request: async () => { throw new Error('denied') } }
      denied = createBrowserKeepAwake(host)
      await denied.start('1m')
      assert.equal(plays, 1)
    } finally {
      held?.stop()
      denied?.stop()
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: prevDoc })
      try { nav.wakeLock = prevLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: prevLock }) }
    }
  })

  it('releases an older wake lock when a newer request wins', async () => {
    const prevDoc = globalThis.document
    const nav = globalThis.navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } | null }
    const prevLock = nav.wakeLock
    const pending: Array<(sentinel: { release: () => Promise<void>; addEventListener: () => void }) => void> = []
    const released: string[] = []
    let held = false
    const doc = {
      hidden: false,
      body: { appendChild() {} },
      pictureInPictureElement: null,
      createElement() {
        return {
          paused: true,
          style: {},
          setAttribute() {},
          addEventListener() {},
          removeAttribute() {},
          pause() {},
          play() { return Promise.resolve() },
          remove() {},
        }
      },
      addEventListener() {},
      removeEventListener() {},
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc })
    nav.wakeLock = {
      request: () => new Promise((resolve) => { pending.push(resolve) }),
    }
    const listeners = new Set<() => void>()
    doc.addEventListener = (_t: string, fn: () => void) => { listeners.add(fn) }
    try {
      const awake = createBrowserKeepAwake({
        helperConnected: () => false,
        sendHelper() {},
        publish(state) { held = state.status === 'On (screen awake)' },
      })
      awake.attach()
      const starting = awake.start('1m')
      await flush()
      for (const fn of listeners) fn()
      await flush()
      assert.equal(pending.length, 2)
      const older = { release: async () => { released.push('old') }, addEventListener() {} }
      const newer = { release: async () => { released.push('new') }, addEventListener() {} }
      pending[1](newer)
      await flush()
      pending[0](older)
      await flush()
      await starting
      assert.deepEqual(released, ['old'])
      assert.equal(held, true)
    } finally {
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: prevDoc })
      try { nav.wakeLock = prevLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: prevLock }) }
    }
  })

  it('does not flash Not supported when release fires before the tab is hidden', async () => {
    const statuses: (string | null)[] = []
    const listeners = new Set<() => void>()
    const prevDoc = globalThis.document
    const nav = globalThis.navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } | null }
    const prevLock = nav.wakeLock
    const origSet = globalThis.setTimeout
    const origClear = globalThis.clearTimeout
    const armed = new Set<ReturnType<typeof setTimeout>>()
    let patched = false
    const patchTimers = () => {
      if (patched) return
      patched = true
      globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
        const id = origSet(fn as (...a: unknown[]) => void, ms, ...(args as []))
        if (ms === WAKE_LOCK_HIDE_SETTLE_MS) armed.add(id)
        return id
      }) as typeof setTimeout
      globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
        if (id != null) armed.delete(id)
        origClear(id as never)
      }) as typeof clearTimeout
    }
    const unpatchTimers = () => {
      if (!patched) return
      patched = false
      globalThis.setTimeout = origSet
      globalThis.clearTimeout = origClear
    }
    let release: (() => void) | null = null
    let requests = 0
    const doc = {
      hidden: false,
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
    nav.wakeLock = {
      request: () => {
        requests += 1
        return Promise.resolve({
          release: async () => {},
          addEventListener(_type: string, fn: () => void) { release = fn },
        })
      },
    }
    const awake = createBrowserKeepAwake({
      helperConnected: () => false,
      sendHelper() {},
      publish(state) { statuses.push(state.status) },
    })
    try {
      awake.attach()
      await awake.start('1m')
      assert.equal(statuses.at(-1), 'On (screen awake)')
      assert.equal(requests, 1)
      assert.equal(doc.hidden, false)

      patchTimers()
      release?.()
      assert.equal(statuses.at(-1), 'On (screen awake)')
      assert.equal(statuses.includes('Not supported'), false)
      assert.equal(armed.size, 1)
      assert.equal(requests, 1)

      doc.hidden = true
      for (const fn of listeners) fn()
      assert.equal(statuses.at(-1), 'Paused, tab hidden')
      assert.equal(statuses.includes('Not supported'), false)
      assert.equal(armed.size, 0)
      assert.equal(requests, 1)
      assert.equal(listeners.size, 1)
      unpatchTimers()
      await flush()
      assert.equal(statuses.at(-1), 'Paused, tab hidden')
      assert.equal(statuses.includes('Not supported'), false)

      doc.hidden = false
      await awake.start('1m')
      assert.equal(statuses.at(-1), 'On (screen awake)')
      patchTimers()
      release?.()
      assert.equal(armed.size, 1)
      assert.equal(statuses.at(-1), 'On (screen awake)')
      awake.stop()
      assert.equal(armed.size, 0)
      assert.equal(awake.view().status, null)
      assert.equal(statuses.includes('Not supported'), false)
      unpatchTimers()
      awake.detach()
      awake.detach()
      assert.equal(listeners.size, 0)
    } finally {
      for (const id of armed) origClear(id)
      unpatchTimers()
      awake.detach()
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: prevDoc })
      try { nav.wakeLock = prevLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: prevLock }) }
    }
  })

  it('shows Not supported when wake lock is missing and video cannot play', async () => {
    const statuses: (string | null)[] = []
    const prevDoc = globalThis.document
    const nav = globalThis.navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } | null }
    const prevLock = nav.wakeLock
    const doc = {
      hidden: false,
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
          play() { return Promise.reject(new Error('no media')) },
          remove() {},
        }
      },
      addEventListener() {},
      removeEventListener() {},
    }
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc })
    try { delete nav.wakeLock } catch { /* define below */ }
    Object.defineProperty(nav, 'wakeLock', { configurable: true, value: undefined })
    const awake = createBrowserKeepAwake({
      helperConnected: () => false,
      sendHelper() {},
      publish(state) { statuses.push(state.status) },
    })
    try {
      await awake.start('1m')
      assert.equal(awake.view().status, 'Not supported')
      assert.equal(statuses.at(-1), 'Not supported')
      assert.equal(awake.view().mode, 'none')
    } finally {
      awake.stop()
      Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: prevDoc })
      try { nav.wakeLock = prevLock } catch { Object.defineProperty(nav, 'wakeLock', { configurable: true, value: prevLock }) }
    }
  })
})
