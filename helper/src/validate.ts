/** Message checks for the desktop helper. Anything that fails is dropped. */

import { isMoverInterval, type MoverInterval } from './mover.js'

export const MAX_DELTA = 2000
export const MAX_TEXT = 500
export const MAX_MODS = 4

export const PRODUCTION_ORIGINS = [
  'https://phonepair.vercel.app',
] as const

/** Allowed only when PHONEPAIR_DEV=1. Never on in the shipped helper. */
export const DEV_ORIGIN = 'http://localhost:5173'

/**
 * null follows PHONEPAIR_DEV. false forces the dev origin off, which the
 * packaged desktop app sets so the variable is never honoured.
 */
let devOriginForce: boolean | null = null

export function setDevOriginEnabled(enabled: boolean | null): void {
  devOriginForce = enabled
}

const NAMED_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Space',
  'PageUp',
  'PageDown',
])

const MODIFIERS = ['cmd', 'ctrl', 'alt', 'shift'] as const
export type Mod = (typeof MODIFIERS)[number]
const MOD_SET = new Set<string>(MODIFIERS)

export type PairMsg = { t: 'pair'; code: string }
export type MoveMsg = { t: 'move'; dx: number; dy: number }
export type ClickMsg = { t: 'click'; btn: 'left' | 'right' }
export type ScrollMsg = { t: 'scroll'; dx: number; dy: number }
export type KeyMsg = { t: 'key'; key: string; mods: Mod[] }
export type TypeMsg = { t: 'type'; text: string }
export type AbsMsg = { t: 'abs'; x: number; y: number }
export type BtnMsg = { t: 'btn'; btn: 'left' | 'right'; state: 'down' | 'up' }
export type DblMsg = { t: 'dbl' }
export type InputMsg = MoveMsg | ClickMsg | ScrollMsg | KeyMsg | TypeMsg | AbsMsg | BtnMsg | DblMsg

export type Parsed<T> = { ok: true; msg: T } | { ok: false }

export function devOriginEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (devOriginForce !== null) return devOriginForce
  return env.PHONEPAIR_DEV === '1'
}

export function originAllowed(origin: string | undefined | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof origin !== 'string') return false
  if ((PRODUCTION_ORIGINS as readonly string[]).includes(origin)) return true
  return origin === DEV_ORIGIN && devOriginEnabled(env)
}

export function isPrintableChar(ch: string): boolean {
  const chars = [...ch]
  if (chars.length !== 1) return false
  const cp = chars[0].codePointAt(0) ?? 0
  return cp >= 32 && cp !== 127
}

export function clampDelta(n: number): number {
  const clamped = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, n))
  return clamped === 0 ? 0 : clamped
}

/** Normalized screen coordinate. Non-finite values never reach here. */
export function clampUnit(n: number): number {
  const clamped = Math.max(0, Math.min(1, n))
  return clamped === 0 ? 0 : clamped
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Canonical key name, or null when the key is not on the allowlist. */
export function canonicalKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) return null
  if (value === ' ' || value === 'Space') return 'Space'
  if (value === 'Esc' || value === 'Escape') return 'Escape'
  if (NAMED_KEYS.has(value)) return value
  if (MOD_SET.has(value)) return value
  if (isPrintableChar(value)) return value
  return null
}

function parseMods(value: unknown): Mod[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_MODS) return null
  const mods: Mod[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !MOD_SET.has(item)) return null
    const mod = item as Mod
    if (!mods.includes(mod)) mods.push(mod)
  }
  return mods
}

export function parseJson(text: string): Parsed<unknown> {
  if (text.length === 0 || text.length > 8192) return { ok: false }
  try {
    return { ok: true, msg: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

export function parsePair(value: unknown): Parsed<PairMsg> {
  if (!isRecord(value)) return { ok: false }
  if (value.t !== 'pair') return { ok: false }
  if (typeof value.code !== 'string' || !/^\d{6}$/.test(value.code)) return { ok: false }
  return { ok: true, msg: { t: 'pair', code: value.code } }
}

export function parseInput(value: unknown): Parsed<InputMsg> {
  if (!isRecord(value)) return { ok: false }
  switch (value.t) {
    case 'move':
    case 'scroll': {
      if (!finite(value.dx) || !finite(value.dy)) return { ok: false }
      return { ok: true, msg: { t: value.t, dx: clampDelta(value.dx), dy: clampDelta(value.dy) } }
    }
    case 'click': {
      if (value.btn !== 'left' && value.btn !== 'right') return { ok: false }
      return { ok: true, msg: { t: 'click', btn: value.btn } }
    }
    case 'abs': {
      if (!finite(value.x) || !finite(value.y)) return { ok: false }
      return { ok: true, msg: { t: 'abs', x: clampUnit(value.x), y: clampUnit(value.y) } }
    }
    case 'btn': {
      if (value.btn !== 'left' && value.btn !== 'right') return { ok: false }
      if (value.state !== 'down' && value.state !== 'up') return { ok: false }
      return { ok: true, msg: { t: 'btn', btn: value.btn, state: value.state } }
    }
    case 'dbl':
      return { ok: true, msg: { t: 'dbl' } }
    case 'key': {
      const key = canonicalKey(value.key)
      if (!key) return { ok: false }
      const mods = parseMods(value.mods)
      if (!mods) return { ok: false }
      return { ok: true, msg: { t: 'key', key, mods } }
    }
    case 'type': {
      if (typeof value.text !== 'string') return { ok: false }
      const chars = [...value.text]
      if (chars.length === 0 || chars.length > MAX_TEXT) return { ok: false }
      if (!chars.every((ch) => isPrintableChar(ch))) return { ok: false }
      return { ok: true, msg: { t: 'type', text: chars.join('') } }
    }
    default:
      return { ok: false }
  }
}

export type MoverOnMsg = { t: 'mover'; on: true; interval: MoverInterval }
export type MoverOffMsg = { t: 'mover'; on: false }
export type MoverMsg = MoverOnMsg | MoverOffMsg

/** on/off. An on command must use 3s, 30s, 1m, or 5m. Anything else is rejected. */
export function parseMover(value: unknown): Parsed<MoverMsg> {
  if (!isRecord(value) || value.t !== 'mover') return { ok: false }
  if (value.on === false) return { ok: true, msg: { t: 'mover', on: false } }
  if (value.on !== true || !isMoverInterval(value.interval)) return { ok: false }
  return { ok: true, msg: { t: 'mover', on: true, interval: value.interval } }
}
