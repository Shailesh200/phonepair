import type { Mod } from './validate.js'

export type KeyPlan =
  | { kind: 'tap'; keys: string[] }
  | { kind: 'type'; text: string; mods: Mod[] }

const NAMED: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Space: 'Space',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
}

const MOD_KEY: Record<Mod, string> = {
  cmd: 'LeftCmd',
  ctrl: 'LeftControl',
  alt: 'LeftAlt',
  shift: 'LeftShift',
}

const DIGIT: Record<string, string> = {
  '0': 'Num0',
  '1': 'Num1',
  '2': 'Num2',
  '3': 'Num3',
  '4': 'Num4',
  '5': 'Num5',
  '6': 'Num6',
  '7': 'Num7',
  '8': 'Num8',
  '9': 'Num9',
}

function isMod(key: string): key is Mod {
  return key === 'cmd' || key === 'ctrl' || key === 'alt' || key === 'shift'
}

/** Turn an allowlisted key into nut-js key names or a typed string. */
export function planKey(key: string, mods: Mod[]): KeyPlan | null {
  const held = mods.map((mod) => MOD_KEY[mod])
  if (isMod(key)) {
    const main = MOD_KEY[key]
    const keys = held.includes(main) ? held : [...held, main]
    return { kind: 'tap', keys }
  }
  const named = NAMED[key]
  if (named) return { kind: 'tap', keys: [...held, named] }
  if ([...key].length !== 1) return null
  if (mods.length === 0) return { kind: 'type', text: key, mods: [] }
  if (/^[a-zA-Z]$/.test(key)) {
    const keys = [...held]
    if (key !== key.toLowerCase() && !mods.includes('shift')) keys.push(MOD_KEY.shift)
    keys.push(key.toUpperCase())
    return { kind: 'tap', keys }
  }
  const digit = DIGIT[key]
  if (digit) return { kind: 'tap', keys: [...held, digit] }
  return { kind: 'type', text: key, mods: [...mods] }
}
