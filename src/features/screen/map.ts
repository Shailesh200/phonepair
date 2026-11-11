/** Map a touch on the phone's screen view onto the laptop video, and classify control gestures.
 *
 * Coordinates are normalized on the video content box after object-fit letterboxing,
 * then inverted through the CSS zoom, pan, and rotation around the frame center.
 */
import { SC_REASON_HELPER, SC_REASON_SURFACE, SC_SURFACE_HINT, type ScAction, type ScMsg } from './sc.ts'

export const MOVE_INTERVAL_MS = 1000 / 60
export const TAP_SLOP_PX = 10
export const DOUBLE_TAP_PX = 28
export const DOUBLE_TAP_MS = 300
export const LONG_PRESS_MS = 500
export const PINCH_SLOP_PX = 12
export const MIN_SCALE = 1
export const MAX_SCALE = 5

export type Point = { x: number; y: number }
export type Box = { width: number; height: number }

export type MapTouchInput = {
  /** Touch in frame-local CSS pixels, origin at the frame's top left. */
  touch: Point
  /** Layout size of the video element before zoom (the object-fit box). */
  frame: Box
  /** Intrinsic video size. */
  video: Box
  /** CSS scale applied around the frame center. Includes the rotate-to-fit factor. */
  scale: number
  /** CSS translate in pixels, applied after scale, origin at the frame center. */
  pan: Point
  /** Clockwise degrees, matching CSS rotate(). */
  rotate?: number
}

/** Uniform scale used by the screen view: zoom, plus 10/16 when the frame is rotated onto its side. */
export function frameScale(zoom: number, rotateDeg: number): number {
  const fit = rotateDeg % 180 === 0 ? 1 : 10 / 16
  return zoom * fit
}

export function moveAllowed(now: number, lastSentAt: number | null, intervalMs = MOVE_INTERVAL_MS): boolean {
  if (!Number.isFinite(now)) return false
  if (lastSentAt == null || !Number.isFinite(lastSentAt)) return true
  // 1e-6 ms absorbs float error on exact 1000/60 multiples without admitting an extra move.
  return now - lastSentAt >= intervalMs - 1e-6
}

/** Human text under the toggle when control is not allowed. `surface` uses the shared hint. */
export function viewOnlyDetail(reason: unknown): string {
  if (typeof reason !== 'string') return SC_SURFACE_HINT
  const text = reason.trim()
  if (!text || text === SC_REASON_SURFACE) return SC_SURFACE_HINT
  if (text === SC_REASON_HELPER) return 'Full laptop is off'
  return text
}

/** Last `sc:avail`. Only a boolean true enables the Control toggle. */
export function readAvail(on: unknown, reason: unknown): { on: boolean; reason?: string } {
  if (on === true) return { on: true }
  const text = typeof reason === 'string' && reason.trim() ? reason.trim() : undefined
  return text ? { on: false, reason: text } : { on: false }
}

function clamp01(n: number): number {
  if (n <= 0) return 0
  if (n >= 1) return 1
  return n
}

function contentBox(frame: Box, video: Box): { x: number; y: number; w: number; h: number } | null {
  if (!(frame.width > 0) || !(frame.height > 0) || !(video.width > 0) || !(video.height > 0)) return null
  const frameAspect = frame.width / frame.height
  const videoAspect = video.width / video.height
  if (videoAspect >= frameAspect) {
    const w = frame.width
    const h = frame.width / videoAspect
    return { x: 0, y: (frame.height - h) / 2, w, h }
  }
  const h = frame.height
  const w = frame.height * videoAspect
  return { x: (frame.width - w) / 2, y: 0, w, h }
}

/** Normalized 0..1 point on the video content, or null when the sizes or the touch cannot be mapped. */
export function mapTouchToContent(input: MapTouchInput): Point | null {
  const box = contentBox(input.frame, input.video)
  if (!box) return null
  const { touch, pan, frame } = input
  if (!Number.isFinite(touch.x) || !Number.isFinite(touch.y)) return null
  if (!Number.isFinite(pan.x) || !Number.isFinite(pan.y)) return null
  if (!(input.scale > 0) || !Number.isFinite(input.scale)) return null
  const rotate = input.rotate ?? 0
  if (!Number.isFinite(rotate)) return null

  const cx = frame.width / 2
  const cy = frame.height / 2
  let dx = touch.x - cx - pan.x
  let dy = touch.y - cy - pan.y
  dx /= input.scale
  dy /= input.scale
  const rad = (-rotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const localX = dx * cos - dy * sin + cx
  const localY = dx * sin + dy * cos + cy
  return {
    x: clamp01((localX - box.x) / box.w),
    y: clamp01((localY - box.y) / box.h),
  }
}

export type Finger = { id: number; px: number; py: number; nx: number; ny: number }

export type GestureState = {
  fingers: Finger[]
  phase: 'idle' | 'hold' | 'drag' | 'right' | 'two' | 'scroll' | 'pinch' | 'suppress'
  origin: Point | null
  pendingTap: { nx: number; ny: number; px: number; py: number; at: number } | null
  doubleCandidate: boolean
  lastMoveAt: number | null
  pendingMove: Point | null
  moveArmed: boolean
  pinchDist: number
  pinchScale: number
  lastMid: Point | null
  scrollFrac: Point
}

export type GestureEvent =
  | { type: 'down'; finger: Finger; now: number; scale: number }
  | { type: 'move'; finger: Finger; now: number; scale: number }
  | { type: 'up'; id: number; now: number; at: Finger | null }
  | { type: 'long'; now: number }
  | { type: 'clickDue'; now: number }
  | { type: 'moveDue'; now: number }
  | { type: 'cancel'; now: number }

export type Effect =
  | { type: 'send'; msg: ScMsg }
  | { type: 'armLong' }
  | { type: 'clearLong' }
  | { type: 'armClick' }
  | { type: 'clearClick' }
  | { type: 'armMove'; waitMs: number }
  | { type: 'clearMove' }
  | { type: 'zoom'; scale: number }

export function initialGesture(): GestureState {
  return {
    fingers: [],
    phase: 'idle',
    origin: null,
    pendingTap: null,
    doubleCandidate: false,
    lastMoveAt: null,
    pendingMove: null,
    moveArmed: false,
    pinchDist: 0,
    pinchScale: 1,
    lastMid: null,
    scrollFrac: { x: 0, y: 0 },
  }
}

function point(a: ScAction, x: number, y: number): Effect {
  return { type: 'send', msg: { t: 'sc', a, x, y } }
}

function cloneState(prev: GestureState): GestureState {
  return {
    ...prev,
    fingers: prev.fingers.map((f) => ({ ...f })),
    origin: prev.origin ? { ...prev.origin } : null,
    pendingTap: prev.pendingTap ? { ...prev.pendingTap } : null,
    pendingMove: prev.pendingMove ? { ...prev.pendingMove } : null,
    lastMid: prev.lastMid ? { ...prev.lastMid } : null,
    scrollFrac: { ...prev.scrollFrac },
  }
}

function queueMove(state: GestureState, effects: Effect[], x: number, y: number, now: number) {
  if (moveAllowed(now, state.lastMoveAt)) {
    state.lastMoveAt = now
    state.pendingMove = null
    effects.push(point('move', x, y))
    if (state.moveArmed) {
      state.moveArmed = false
      effects.push({ type: 'clearMove' })
    }
    return
  }
  state.pendingMove = { x, y }
  if (!state.moveArmed) {
    state.moveArmed = true
    const wait = MOVE_INTERVAL_MS - (now - (state.lastMoveAt ?? now))
    effects.push({ type: 'armMove', waitMs: Math.max(0, wait) })
  }
}

function pushScroll(state: GestureState, effects: Effect[], dx: number, dy: number) {
  state.scrollFrac.x += dx
  state.scrollFrac.y += dy
  const sx = Math.trunc(state.scrollFrac.x)
  const sy = Math.trunc(state.scrollFrac.y)
  state.scrollFrac.x -= sx
  state.scrollFrac.y -= sy
  if (sx !== 0 || sy !== 0) effects.push({ type: 'send', msg: { t: 'sc', a: 'scroll', dx: sx, dy: sy } })
}

function beginHold(state: GestureState, effects: Effect[], finger: Finger, now: number) {
  const tap = state.pendingTap
  const candidate = !!tap
    && now - tap.at <= DOUBLE_TAP_MS
    && Math.hypot(finger.px - tap.px, finger.py - tap.py) <= DOUBLE_TAP_PX
  if (tap && !candidate) {
    effects.push(point('click', tap.nx, tap.ny))
    state.pendingTap = null
    effects.push({ type: 'clearClick' })
  } else if (candidate) {
    effects.push({ type: 'clearClick' })
  }
  state.doubleCandidate = candidate
  state.phase = 'hold'
  state.origin = { x: finger.px, y: finger.py }
  effects.push({ type: 'armLong' })
}

function beginTwo(state: GestureState, effects: Effect[], scale: number) {
  effects.push({ type: 'clearLong' })
  effects.push({ type: 'clearClick' })
  if (state.pendingTap) {
    effects.push(point('click', state.pendingTap.nx, state.pendingTap.ny))
    state.pendingTap = null
  }
  if (state.phase === 'drag') {
    const drag = state.fingers[0]
    state.pendingMove = null
    state.moveArmed = false
    effects.push({ type: 'clearMove' })
    if (drag) effects.push(point('up', drag.nx, drag.ny))
  }
  state.doubleCandidate = false
  state.phase = 'two'
  const a = state.fingers[0]
  const b = state.fingers[1]
  state.pinchDist = Math.hypot(a.px - b.px, a.py - b.py)
  state.pinchScale = scale > 0 && Number.isFinite(scale) ? scale : 1
  state.lastMid = { x: (a.px + b.px) / 2, y: (a.py + b.py) / 2 }
  state.scrollFrac = { x: 0, y: 0 }
}

function onMultiMove(state: GestureState, effects: Effect[]) {
  const a = state.fingers[0]
  const b = state.fingers[1]
  if (!a || !b) return
  const dist = Math.hypot(a.px - b.px, a.py - b.py)
  const mid = { x: (a.px + b.px) / 2, y: (a.py + b.py) / 2 }
  if (state.phase === 'two') {
    const grew = Math.abs(dist - state.pinchDist) >= PINCH_SLOP_PX
    const slid = state.lastMid != null && Math.hypot(mid.x - state.lastMid.x, mid.y - state.lastMid.y) >= TAP_SLOP_PX
    if (grew) state.phase = 'pinch'
    else if (slid) state.phase = 'scroll'
    else return
  }
  if (state.phase === 'pinch') {
    if (state.pinchDist > 0) {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.pinchScale * (dist / state.pinchDist)))
      effects.push({ type: 'zoom', scale })
    }
    return
  }
  if (state.phase === 'scroll' && state.lastMid) {
    const dx = mid.x - state.lastMid.x
    const dy = mid.y - state.lastMid.y
    state.lastMid = mid
    pushScroll(state, effects, dx, dy)
  }
}

function finishDrag(state: GestureState, effects: Effect[], at: Finger | null) {
  effects.push({ type: 'clearMove' })
  state.moveArmed = false
  state.pendingMove = null
  const nx = at?.nx ?? 0
  const ny = at?.ny ?? 0
  effects.push(point('up', nx, ny))
}

function finishTap(state: GestureState, effects: Effect[], at: Finger | null, now: number) {
  if (!at) return
  if (state.doubleCandidate && state.pendingTap) {
    state.pendingTap = null
    state.doubleCandidate = false
    effects.push({ type: 'clearClick' })
    effects.push(point('dbl', at.nx, at.ny))
    return
  }
  state.pendingTap = { nx: at.nx, ny: at.ny, px: at.px, py: at.py, at: now }
  effects.push({ type: 'armClick' })
}

export function gestureStep(prev: GestureState, ev: GestureEvent): { state: GestureState; effects: Effect[] } {
  const state = cloneState(prev)
  const effects: Effect[] = []

  if (ev.type === 'cancel') {
    if (state.phase === 'drag') {
      const finger = state.fingers[0]
      effects.push(point('up', finger?.nx ?? 0, finger?.ny ?? 0))
    }
    effects.push({ type: 'clearLong' }, { type: 'clearClick' }, { type: 'clearMove' })
    return { state: initialGesture(), effects }
  }

  if (ev.type === 'long') {
    if (state.phase !== 'hold') return { state, effects }
    const finger = state.fingers[0]
    if (!finger) return { state, effects }
    if (state.pendingTap) {
      effects.push(point('click', state.pendingTap.nx, state.pendingTap.ny))
      state.pendingTap = null
    }
    effects.push({ type: 'clearClick' })
    effects.push(point('right', finger.nx, finger.ny))
    state.phase = 'right'
    state.doubleCandidate = false
    return { state, effects }
  }

  if (ev.type === 'clickDue') {
    if (state.doubleCandidate && state.phase === 'hold') return { state, effects }
    if (!state.pendingTap) return { state, effects }
    const tap = state.pendingTap
    state.pendingTap = null
    effects.push(point('click', tap.nx, tap.ny))
    return { state, effects }
  }

  if (ev.type === 'moveDue') {
    state.moveArmed = false
    if (state.phase !== 'drag' || !state.pendingMove) return { state, effects }
    if (!moveAllowed(ev.now, state.lastMoveAt)) {
      const wait = MOVE_INTERVAL_MS - (ev.now - (state.lastMoveAt ?? ev.now))
      state.moveArmed = true
      effects.push({ type: 'armMove', waitMs: Math.max(0, wait) })
      return { state, effects }
    }
    const pending = state.pendingMove
    state.pendingMove = null
    state.lastMoveAt = ev.now
    effects.push(point('move', pending.x, pending.y))
    return { state, effects }
  }

  if (ev.type === 'down') {
    if (state.fingers.some((f) => f.id === ev.finger.id)) return { state, effects }
    state.fingers.push({ ...ev.finger })
    if (state.fingers.length === 1 && state.phase !== 'suppress') beginHold(state, effects, ev.finger, ev.now)
    else if (state.fingers.length === 2) beginTwo(state, effects, ev.scale)
    return { state, effects }
  }

  if (ev.type === 'move') {
    const index = state.fingers.findIndex((f) => f.id === ev.finger.id)
    if (index < 0) return { state, effects }
    state.fingers[index] = { ...ev.finger }
    if (state.phase === 'hold' && state.fingers.length === 1 && state.origin) {
      const travel = Math.hypot(ev.finger.px - state.origin.x, ev.finger.py - state.origin.y)
      if (travel >= TAP_SLOP_PX) {
        effects.push({ type: 'clearLong' })
        if (state.pendingTap) {
          effects.push(point('click', state.pendingTap.nx, state.pendingTap.ny))
          state.pendingTap = null
          effects.push({ type: 'clearClick' })
        }
        state.doubleCandidate = false
        state.phase = 'drag'
        effects.push(point('down', ev.finger.nx, ev.finger.ny))
        queueMove(state, effects, ev.finger.nx, ev.finger.ny, ev.now)
      }
      return { state, effects }
    }
    if (state.phase === 'drag' && state.fingers.length === 1) {
      queueMove(state, effects, ev.finger.nx, ev.finger.ny, ev.now)
      return { state, effects }
    }
    if ((state.phase === 'two' || state.phase === 'scroll' || state.phase === 'pinch') && state.fingers.length >= 2) {
      onMultiMove(state, effects)
    }
    return { state, effects }
  }

  if (ev.type === 'up') {
    const index = state.fingers.findIndex((f) => f.id === ev.id)
    if (index >= 0) state.fingers.splice(index, 1)
    if (state.fingers.length > 0) {
      if (state.phase === 'two' || state.phase === 'scroll' || state.phase === 'pinch') {
        state.phase = 'suppress'
        effects.push({ type: 'clearLong' })
      }
      return { state, effects }
    }
    effects.push({ type: 'clearLong' })
    if (state.phase === 'drag') finishDrag(state, effects, ev.at)
    else if (state.phase === 'hold') finishTap(state, effects, ev.at, ev.now)
    state.phase = 'idle'
    state.origin = null
    state.doubleCandidate = false
    state.pendingMove = null
    state.moveArmed = false
    effects.push({ type: 'clearMove' })
    return { state, effects }
  }

  return { state, effects }
}
