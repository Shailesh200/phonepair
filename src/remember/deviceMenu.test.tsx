import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEVICE_META_KEY, deviceLabel } from './deviceMeta.ts'
import {
  chooseDeviceMenuItem,
  deviceMenuActions,
  deviceMenuAfterToggle,
  deviceMenuDismissHandlers,
  deviceMenuIndexAfterKey,
  deviceMenuPlacement,
  savedLaptopConnected,
  savedPhoneConnected,
} from './deviceMenu.ts'
import { applyDeviceRename, DeviceCard } from './ui.tsx'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    getItem(key: string) { return data.has(key) ? data.get(key)! : null },
    setItem(key: string, value: string) { data.set(String(key), String(value)) },
    removeItem(key: string) { data.delete(key) },
    clear() { data.clear() },
    key(index: number) { return [...data.keys()][index] ?? null },
    get length() { return data.size },
  }
}

function menuSlice(html: string) {
  const start = html.indexOf('role="menu"')
  assert.ok(start >= 0)
  const end = html.indexOf('</div>', start)
  assert.ok(end > start)
  return html.slice(start, end)
}

describe('device card menu', () => {
  let previous: PropertyDescriptor | undefined

  beforeEach(() => {
    previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() })
  })

  afterEach(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('opens from the kebab and closes on Escape, outside click, and after an item', () => {
    assert.equal(deviceMenuAfterToggle(false), true)
    assert.equal(deviceMenuAfterToggle(true), false)

    const closed = renderToStaticMarkup(
      <DeviceCard id="phone-1" fallback="Pixel" testId="saved-phone" connected={false} onForget={() => {}} />,
    )
    assert.match(closed, /aria-haspopup="menu"/)
    assert.match(closed, /aria-expanded="false"/)
    assert.match(closed, /aria-label="More actions for Pixel"/)
    assert.equal(closed.includes('role="menu"'), false)

    const open = renderToStaticMarkup(
      <DeviceCard id="phone-1" fallback="Pixel" testId="saved-phone" connected={false} onForget={() => {}} initialMenuOpen />,
    )
    assert.match(open, /aria-expanded="true"/)
    assert.match(open, /role="menu"/)
    assert.match(open, /role="menuitem"/)

    let shown = true
    const inside = {}
    const outside = {}
    const dismiss = deviceMenuDismissHandlers({
      contains: (node) => node === inside,
      close: () => { shown = false },
    })
    dismiss.keydown({ key: 'Escape' })
    assert.equal(shown, false)

    shown = true
    dismiss.pointerdown({ target: outside })
    assert.equal(shown, false)

    shown = true
    dismiss.pointerdown({ target: inside })
    assert.equal(shown, true)

    const order: string[] = []
    chooseDeviceMenuItem('forget', { onForget: () => order.push('forget') }, () => order.push('close'))
    assert.deepEqual(order, ['close', 'forget'])

    assert.equal(deviceMenuIndexAfterKey(0, 3, 'ArrowDown'), 1)
    assert.equal(deviceMenuIndexAfterKey(0, 3, 'ArrowUp'), 2)
    assert.equal(deviceMenuIndexAfterKey(2, 3, 'Home'), 0)
    assert.equal(deviceMenuIndexAfterKey(0, 3, 'End'), 2)

    const ui = readFileSync(join(process.cwd(), 'src/remember/ui.tsx'), 'utf8')
    assert.match(ui, /deviceMenuAfterToggle\(current\)/)
    assert.match(ui, /deviceMenuDismissHandlers\(\{/)
    assert.match(ui, /chooseDeviceMenuItem\(action, handlers/)
    assert.match(ui, /deviceMenuIndexAfterKey\(current, actions\.length, event\.key\)/)
  })

  it('shows Disconnect only while connected, and Connect only while not', () => {
    assert.deepEqual(deviceMenuActions(true), ['disconnect', 'edit', 'forget'])
    assert.deepEqual(deviceMenuActions(false), ['connect', 'edit', 'forget'])

    const live = renderToStaticMarkup(
      <DeviceCard id="phone-1" fallback="Pixel" testId="saved-phone" connected onForget={() => {}} initialMenuOpen />,
    )
    const liveMenu = menuSlice(live)
    assert.match(liveMenu, /data-testid="saved-phone-disconnect"/)
    assert.doesNotMatch(liveMenu, /data-testid="saved-phone-connect"/)
    assert.match(liveMenu, /data-testid="saved-phone-edit"/)
    assert.match(liveMenu, /data-testid="saved-phone-forget"/)

    const idle = renderToStaticMarkup(
      <DeviceCard id="lap-1" fallback="Desk" testId="saved-laptop" connected={false} onForget={() => {}} initialMenuOpen />,
    )
    const idleMenu = menuSlice(idle)
    assert.match(idleMenu, /data-testid="saved-laptop-connect"/)
    assert.doesNotMatch(idleMenu, /data-testid="saved-laptop-disconnect"/)

    assert.equal(savedLaptopConnected({
      connected: true,
      rememberListenId: 'lap-1',
      sessionPaired: true,
      listenId: 'lap-1',
      savedCount: 2,
    }), true)
    assert.equal(savedLaptopConnected({
      connected: false,
      rememberListenId: 'lap-1',
      sessionPaired: true,
      listenId: 'lap-1',
      savedCount: 1,
    }), false)
    assert.equal(savedPhoneConnected({
      connected: true,
      remoteName: 'Pixel',
      phoneName: 'Pixel',
      label: 'Pixel',
    }), true)
    assert.equal(savedPhoneConnected({
      connected: true,
      remoteName: 'Other',
      phoneName: 'Pixel',
      label: 'Pixel',
    }), false)
  })

  it('renames from Edit and Forget calls the handler, with the heart outside the menu', () => {
    applyDeviceRename('phone-1', 'Kitchen')
    assert.equal(deviceLabel('phone-1', 'Pixel'), 'Kitchen')
    const stored = JSON.parse(globalThis.localStorage.getItem(DEVICE_META_KEY) || '{}') as { devices: Record<string, { name: string }> }
    assert.equal(stored.devices['phone-1'].name, 'Kitchen')

    let forgot = 0
    let edited = 0
    chooseDeviceMenuItem('edit', { onEdit: () => { edited += 1 } }, () => {})
    chooseDeviceMenuItem('forget', { onForget: () => { forgot += 1 } }, () => {})
    assert.equal(edited, 1)
    assert.equal(forgot, 1)

    const html = renderToStaticMarkup(
      <DeviceCard
        id="phone-1"
        fallback="Pixel"
        testId="saved-phone"
        connected={false}
        onForget={() => { forgot += 1 }}
        initialMenuOpen
      />,
    )
    const menu = menuSlice(html)
    assert.match(menu, /data-testid="saved-phone-edit"/)
    assert.match(menu, />Edit</)
    assert.match(menu, /data-testid="saved-phone-forget"/)
    assert.equal(menu.includes('data-testid="device-fav"'), false)
    assert.ok(html.indexOf('data-testid="device-fav"') < html.indexOf('role="menu"'))
    assert.match(html, /aria-pressed=/)

    const ui = readFileSync(join(process.cwd(), 'src/remember/ui.tsx'), 'utf8')
    assert.match(ui, /onEdit: \(\) => setEditSignal/)
    assert.match(ui, /applyDeviceRename\(id, draft\)/)
    assert.match(ui, /forgetHostPhone\(ctx, p\.id\)/)
    assert.match(ui, /onConnect=\{\(\) => onPick\(lap\)\}/)
    assert.match(ui, /onDisconnect=\{\(\) => ctx\?\.link\.disconnect\(\)\}/)
    assert.match(ui, /onDisconnect=\{\(\) => ctx\.link\.disconnect\(\)\}/)
  })

  it('keeps the menu inside a 360px viewport', () => {
    const placed = deviceMenuPlacement({
      viewportWidth: 360,
      viewportHeight: 640,
      anchorTop: 96,
      anchorBottom: 140,
      anchorRight: 344,
      menuWidth: 220,
      menuHeight: 140,
    })
    assert.equal(placed.fits, true)
    assert.ok(placed.left >= 0)
    assert.ok(placed.left + placed.width <= 360)
    assert.ok(placed.top + 140 <= 640)

    const low = deviceMenuPlacement({
      viewportWidth: 360,
      viewportHeight: 200,
      anchorTop: 160,
      anchorBottom: 188,
      anchorRight: 360,
      menuWidth: 220,
      menuHeight: 140,
    })
    assert.equal(low.fits, true)
    assert.ok(low.top + 140 <= 200)

    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    assert.match(css, /max-width:min\(220px,calc\(100vw - 24px\)\)/)
    assert.match(css, /\.pp-device-menu\.is-fixed\{position:fixed/)
    assert.match(css, /\.pp-device-row\{position:relative[^}]*overflow:visible/)
  })
})
