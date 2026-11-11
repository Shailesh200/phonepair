import { Key, Point, keyboard, mouse } from '@nut-tree-fork/nut-js'
import { planKey } from './keys.js'
import type { Injector } from './server.js'
import type { Mod } from './validate.js'

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

async function tap(names: string[]) {
  const keys: Key[] = []
  for (const name of names) {
    const key = nutKey(name)
    if (key === null) return
    keys.push(key)
  }
  if (!keys.length) return
  await keyboard.pressKey(...keys)
  await keyboard.releaseKey(...keys)
}

async function typeText(text: string, mods: Mod[]) {
  if (!mods.length) {
    await keyboard.type(text)
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
    await keyboard.type(text)
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

export function createNutInjector(): Injector {
  mouse.config.autoDelayMs = 0
  keyboard.config.autoDelayMs = 0
  mouse.config.mouseSpeed = 4000
  let chain = Promise.resolve()
  const run = (fn: () => Promise<void>) => {
    const pending = chain.then(fn, fn)
    chain = pending.then(() => undefined, () => undefined)
    return pending
  }
  return {
    move(dx, dy) {
      return run(async () => {
        if (!dx && !dy) return
        const pos = await mouse.getPosition()
        await mouse.setPosition(new Point(Math.round(pos.x + dx), Math.round(pos.y + dy)))
      })
    },
    click(btn) {
      return run(async () => {
        if (btn === 'right') await mouse.rightClick()
        else await mouse.leftClick()
      })
    },
    scroll(dx, dy) {
      return run(async () => {
        const y = scrollSteps(dy)
        const x = scrollSteps(dx)
        if (y > 0) await mouse.scrollDown(y)
        else if (y < 0) await mouse.scrollUp(-y)
        if (x > 0) await mouse.scrollRight(x)
        else if (x < 0) await mouse.scrollLeft(-x)
      })
    },
    key(key, mods) {
      return run(async () => {
        const plan = planKey(key, mods)
        if (!plan) return
        if (plan.kind === 'tap') await tap(plan.keys)
        else await typeText(plan.text, plan.mods)
      })
    },
    type(text) {
      return run(async () => {
        await keyboard.type(text)
      })
    },
  }
}
