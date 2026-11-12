import { Button, Key, Point, keyboard, mouse, screen } from '@nut-tree-fork/nut-js'
import { planKey } from './keys.js'
import { NUDGE_DWELL_MS, performNudge } from './mover.js'
import type { Injector } from './server.js'
import type { Mod } from './validate.js'

export type BtnName = 'left' | 'right'

/** Map a normalized point onto the primary display in the same logical points nut-js uses. */
export function mapAbs(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const w = Number.isFinite(width) && width > 0 ? Math.floor(width) : 0
  const h = Number.isFinite(height) && height > 0 ? Math.floor(height) : 0
  const nx = Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0
  const ny = Number.isFinite(y) ? Math.min(1, Math.max(0, y)) : 0
  // x = 1 lands on the last on-screen point, not one pixel past the display.
  const px = w <= 1 ? 0 : Math.min(w - 1, Math.max(0, Math.round(nx * w)))
  const py = h <= 1 ? 0 : Math.min(h - 1, Math.max(0, Math.round(ny * h)))
  return { x: px, y: py }
}

export type PointerDriver = {
  size(): Promise<{ width: number; height: number }>
  moveTo(x: number, y: number): Promise<void>
  press(btn: BtnName): Promise<void>
  release(btn: BtnName): Promise<void>
  doubleClick(): Promise<void>
}

/** Tracks the one button this session pressed, and never releases a button it did not press. */
export function createPointerController(driver: PointerDriver) {
  let held: BtnName | null = null
  return {
    held: () => held,
    async abs(x: number, y: number) {
      const { width, height } = await driver.size()
      const point = mapAbs(x, y, width, height)
      await driver.moveTo(point.x, point.y)
    },
    async btn(btn: BtnName, state: 'down' | 'up') {
      if (state === 'down') {
        if (held === btn) return
        if (held) {
          const prev = held
          await driver.release(prev)
          if (held === prev) held = null
        }
        await driver.press(btn)
        held = btn
        return
      }
      if (held !== btn) return
      await driver.release(btn)
      if (held === btn) held = null
    },
    async dbl() {
      if (held) {
        const prev = held
        await driver.release(prev)
        if (held === prev) held = null
      }
      await driver.doubleClick()
    },
    async release() {
      if (!held) return
      const prev = held
      await driver.release(prev)
      if (held === prev) held = null
    },
  }
}

function nutButton(btn: BtnName): Button {
  return btn === 'right' ? Button.RIGHT : Button.LEFT
}

const KEY = Key as unknown as Record<string, Key | string>

function nutKey(name: string): Key | null {
  const value = KEY[name]
  return typeof value === 'number' ? value : null
}

function scrollSteps(delta: number): number {
  if (!delta) return 0
  const steps = Math.trunc(delta / 40)
  if (steps === 0) return delta > 0 ? 1 : -1
  return Math.max(-25, Math.min(25, steps))
}

export type ScrollDir = 'up' | 'down' | 'left' | 'right'
export type NutScroll = 'scrollUp' | 'scrollDown' | 'scrollLeft' | 'scrollRight'

/** Positive dy scrolls down. Positive dx scrolls right. */
export function scrollPlan(dx: number, dy: number): { dir: ScrollDir; steps: number }[] {
  const plan: { dir: ScrollDir; steps: number }[] = []
  const y = scrollSteps(dy)
  const x = scrollSteps(dx)
  if (y > 0) plan.push({ dir: 'down', steps: y })
  else if (y < 0) plan.push({ dir: 'up', steps: -y })
  if (x > 0) plan.push({ dir: 'right', steps: x })
  else if (x < 0) plan.push({ dir: 'left', steps: -x })
  return plan
}

/** nut-js method that moves the wheel in `dir` on this OS.
 * macOS passes the horizontal wheel through, and a positive value goes right,
 * so scrollRight/scrollLeft match their names.
 * Linux posts X11 button 6 (left) for a positive scrollMouse x and button 7
 * (right) for a negative one. nut-js scrollRight uses the positive x, so on
 * Linux that call scrolls left. Windows flips x "to match other platforms",
 * which follows the Linux sign, not macOS.
 */
export function nutScrollName(dir: ScrollDir, platform: NodeJS.Platform = process.platform): NutScroll {
  if (dir === 'up') return 'scrollUp'
  if (dir === 'down') return 'scrollDown'
  const horizontalInverted = platform === 'linux' || platform === 'win32'
  if (dir === 'right') return horizontalInverted ? 'scrollLeft' : 'scrollRight'
  return horizontalInverted ? 'scrollRight' : 'scrollLeft'
}

/** One keystroke. `keyboard.type(Key…)` is a single keyTap, not press plus release. */
export type KeyPort = {
  tap(names: string[]): Promise<void>
  typeChar(ch: string): Promise<void>
}

/** One `remote:type` character becomes one keystroke. Newline is one Return. */
export function strokesForText(text: string): Array<{ op: 'char'; ch: string } | { op: 'tap'; names: string[] }> {
  return [...text].map((ch) => {
    if (ch === '\n' || ch === '\r') return { op: 'tap', names: ['Return'] }
    return { op: 'char', ch }
  })
}

export async function playStrokes(port: KeyPort, text: string): Promise<void> {
  for (const stroke of strokesForText(text)) {
    if (stroke.op === 'tap') await port.tap(stroke.names)
    else await port.typeChar(stroke.ch)
  }
}

async function nutTap(names: string[]) {
  const keys: Key[] = []
  for (const name of names) {
    const key = nutKey(name)
    if (key === null) return
    keys.push(key)
  }
  if (!keys.length) return
  await keyboard.type(...keys)
}

async function nutTypeChar(ch: string) {
  await keyboard.type(ch)
}

const nutKeys: KeyPort = { tap: nutTap, typeChar: nutTypeChar }

async function typeText(port: KeyPort, text: string, mods: Mod[]) {
  if (!mods.length) {
    await playStrokes(port, text)
    return
  }
  const held: Key[] = []
  for (const mod of mods) {
    const name = mod === 'cmd' ? 'LeftCmd' : mod === 'ctrl' ? 'LeftControl' : mod === 'alt' ? 'LeftAlt' : 'LeftShift'
    const key = nutKey(name)
    if (key !== null) held.push(key)
  }
  if (held.length) await keyboard.pressKey(...held)
  try {
    await playStrokes(port, text)
  } finally {
    if (held.length) await keyboard.releaseKey(...held)
  }
}

export async function nutNoop(): Promise<void> {
  const pos = await mouse.getPosition()
  await mouse.setPosition(new Point(Math.round(pos.x), Math.round(pos.y)))
}

export async function releaseModifiers(): Promise<void> {
  const names = ['LeftShift', 'RightShift', 'LeftControl', 'RightControl', 'LeftAlt', 'RightAlt', 'LeftCmd', 'RightCmd', 'LeftSuper', 'RightSuper', 'LeftMeta', 'RightMeta']
  for (const name of names) {
    const key = nutKey(name)
    if (key === null) continue
    try { await keyboard.releaseKey(key) } catch { /* already up */ }
  }
}

export type CursorPort = {
  getPosition(): Promise<{ x: number; y: number }>
  setPosition(x: number, y: number): Promise<void>
}

export type ClickPort = {
  press(btn: 'left' | 'right'): Promise<void>
  release(btn: 'left' | 'right'): Promise<void>
}

const nutCursor: CursorPort = {
  async getPosition() {
    const pos = await mouse.getPosition()
    return { x: pos.x, y: pos.y }
  },
  async setPosition(x, y) {
    await mouse.setPosition(new Point(x, y))
  },
}

const nutClick: ClickPort = {
  async press(btn) {
    await mouse.pressButton(btn === 'right' ? Button.RIGHT : Button.LEFT)
  },
  async release(btn) {
    await mouse.releaseButton(btn === 'right' ? Button.RIGHT : Button.LEFT)
  },
}

export function createNutInjector(port: KeyPort = nutKeys, io?: { cursor?: CursorPort; click?: ClickPort; dwellMs?: number }): Injector {
  const cursor = io?.cursor ?? nutCursor
  const buttons = io?.click ?? nutClick
  const dwellMs = io?.dwellMs ?? NUDGE_DWELL_MS
  mouse.config.autoDelayMs = 0
  keyboard.config.autoDelayMs = 0
  mouse.config.mouseSpeed = 4000
  const pointer = createPointerController({
    async size() {
      return { width: await screen.width(), height: await screen.height() }
    },
    async moveTo(x, y) {
      await mouse.setPosition(new Point(x, y))
    },
    async press(btn) {
      await mouse.pressButton(nutButton(btn))
    },
    async release(btn) {
      await mouse.releaseButton(nutButton(btn))
    },
    async doubleClick() {
      await mouse.doubleClick(Button.LEFT)
    },
  })
  let chain = Promise.resolve()
  const run = (fn: () => Promise<void>) => {
    const pending = chain.then(fn, fn)
    chain = pending.then(() => undefined, () => undefined)
    return pending
  }
  return {
    move(dx, dy) {
      return run(async () => {
        await pointer.release()
        if (!dx && !dy) return
        const pos = await mouse.getPosition()
        await mouse.setPosition(new Point(Math.round(pos.x + dx), Math.round(pos.y + dy)))
      })
    },
    click(btn) {
      return run(async () => {
        await pointer.release()
        const which = btn === 'right' ? 'right' : 'left'
        await buttons.press(which)
        await buttons.release(which)
      })
    },
    scroll(dx, dy) {
      return run(async () => {
        await pointer.release()
        for (const step of scrollPlan(dx, dy)) {
          const steps = step.steps
          switch (nutScrollName(step.dir)) {
            case 'scrollDown':
              await mouse.scrollDown(steps)
              break
            case 'scrollUp':
              await mouse.scrollUp(steps)
              break
            case 'scrollRight':
              await mouse.scrollRight(steps)
              break
            case 'scrollLeft':
              await mouse.scrollLeft(steps)
              break
          }
        }
      })
    },
    key(key, mods) {
      return run(async () => {
        await pointer.release()
        const plan = planKey(key, mods)
        if (!plan) return
        if (plan.kind === 'tap') await port.tap(plan.keys)
        else await typeText(port, plan.text, plan.mods)
      })
    },
    type(text) {
      return run(async () => {
        await pointer.release()
        await playStrokes(port, text)
      })
    },
    abs(x, y) {
      return run(() => pointer.abs(x, y))
    },
    btn(btn, state) {
      return run(() => pointer.btn(btn, state))
    },
    dbl() {
      return run(() => pointer.dbl())
    },
    release() {
      return run(() => pointer.release())
    },
    nudge() {
      return run(() => performNudge(cursor, { dwellMs }))
    },
  }
}
