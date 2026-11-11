import {
  SC_ACTIONS,
  SC_REASON_EMPTY,
  SC_REASON_HELPER,
  SC_REASON_SURFACE,
  type ScAction,
  type ScAvailMsg,
} from './sc.ts'

/** Same bound the helper uses for scroll deltas. */
export const SCROLL_LIMIT = 2000

export type HelperCommand =
  | { t: 'abs'; x: number; y: number }
  | { t: 'btn'; btn: 'left' | 'right'; state: 'down' | 'up' }
  | { t: 'dbl' }
  | { t: 'scroll'; dx: number; dy: number }

const ACTIONS = new Set<string>(SC_ACTIONS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function clampUnit(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function clampScroll(n: number): number {
  const clamped = Math.max(-SCROLL_LIMIT, Math.min(SCROLL_LIMIT, n))
  return clamped === 0 ? 0 : clamped
}

/** displaySurface from a captured track. Anything other than a non-empty string is ignored. */
export function readDisplaySurface(settings: { displaySurface?: unknown } | null | undefined): string | undefined {
  const value = settings?.displaySurface
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** on is true only while sharing a monitor and the helper is connected. */
export function availability(helperOn: boolean, displaySurface: string | undefined, sharing: boolean): ScAvailMsg {
  if (!sharing) return { t: 'sc:avail', on: false }
  if (!displaySurface) return { t: 'sc:avail', on: false, reason: SC_REASON_EMPTY }
  if (displaySurface !== 'monitor') return { t: 'sc:avail', on: false, reason: SC_REASON_SURFACE }
  if (!helperOn) return { t: 'sc:avail', on: false, reason: SC_REASON_HELPER }
  return { t: 'sc:avail', on: true }
}

function point(x: number, y: number): { t: 'abs'; x: number; y: number } {
  return { t: 'abs', x: clampUnit(x), y: clampUnit(y) }
}

function tap(btn: 'left' | 'right', x: number, y: number): HelperCommand[] {
  return [
    point(x, y),
    { t: 'btn', btn, state: 'down' },
    { t: 'btn', btn, state: 'up' },
  ]
}

/** After Stop, Esc, or sc:stop, pointer messages are dropped until sc:start or a new share. */
export type ControlGate = {
  stopped: boolean
  controlling: boolean
}

export function initialControlGate(): ControlGate {
  return { stopped: false, controlling: false }
}

export type ControlEvent =
  | { type: 'stop' }
  | { type: 'start'; avail: boolean }
  | { type: 'share' }
  | { type: 'pointer'; avail: boolean }

/** `forward` is false when a pointer message must be dropped. */
export function stepControl(gate: ControlGate, event: ControlEvent): { gate: ControlGate; forward: boolean } {
  if (event.type === 'stop') return { gate: { stopped: true, controlling: false }, forward: false }
  if (event.type === 'share') return { gate: { stopped: false, controlling: false }, forward: false }
  if (event.type === 'start') {
    if (!event.avail) return { gate: { stopped: false, controlling: false }, forward: false }
    return { gate: { stopped: false, controlling: true }, forward: false }
  }
  if (gate.stopped || !event.avail) return { gate, forward: false }
  return { gate: { stopped: false, controlling: true }, forward: true }
}

/** Phone `sc` message -> helper commands. Empty when the payload is not a control event. */
export function helperCommands(value: unknown): HelperCommand[] {
  if (!isRecord(value) || value.t !== 'sc') return []
  if (value.a === 'scroll') {
    if (!finite(value.dx) || !finite(value.dy)) return []
    const dx = clampScroll(value.dx)
    const dy = clampScroll(value.dy)
    if (!dx && !dy) return []
    return [{ t: 'scroll', dx, dy }]
  }
  if (typeof value.a !== 'string' || !ACTIONS.has(value.a)) return []
  if (!finite(value.x) || !finite(value.y)) return []
  const action = value.a as ScAction
  const x = value.x
  const y = value.y
  switch (action) {
    case 'move':
      return [point(x, y)]
    case 'down':
      return [point(x, y), { t: 'btn', btn: 'left', state: 'down' }]
    case 'up':
      return [point(x, y), { t: 'btn', btn: 'left', state: 'up' }]
    case 'click':
      return tap('left', x, y)
    case 'right':
      return tap('right', x, y)
    case 'dbl':
      return [point(x, y), { t: 'dbl' }]
    default:
      return []
  }
}
