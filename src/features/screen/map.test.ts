import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SC_EMPTY_HINT, SC_REASON_EMPTY, SC_REASON_HELPER, SC_REASON_SURFACE, SC_SURFACE_HINT } from './sc.ts'
import {
  DOUBLE_TAP_MS,
  LONG_PRESS_MS,
  MOVE_INTERVAL_MS,
  frameScale,
  gestureStep,
  initialGesture,
  mapTouchToContent,
  moveAllowed,
  readAvail,
  viewOnlyDetail,
  type Effect,
  type Finger,
  type GestureEvent,
  type GestureState,
} from './map.ts'

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ~= ${expected}`)
}

const landscape = { width: 320, height: 180 }
const portrait = { width: 90, height: 160 }
const frame = { width: 160, height: 100 }

describe('mapTouchToContent letterbox', () => {
  it('removes top and bottom bars for a landscape video', () => {
    const center = mapTouchToContent({
      touch: { x: 80, y: 50 },
      frame,
      video: landscape,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.ok(center)
    near(center.x, 0.5)
    near(center.y, 0.5)

    const topOfContent = mapTouchToContent({
      touch: { x: 80, y: 5 },
      frame,
      video: landscape,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.ok(topOfContent)
    near(topOfContent.y, 0)

    const letterbox = mapTouchToContent({
      touch: { x: 80, y: 0 },
      frame,
      video: landscape,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.equal(letterbox, null)

    const below = mapTouchToContent({
      touch: { x: 80, y: 100 },
      frame,
      video: landscape,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.equal(below, null)
  })

  it('removes side bars for a portrait video in a landscape frame', () => {
    const center = mapTouchToContent({
      touch: { x: 80, y: 50 },
      frame,
      video: portrait,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.ok(center)
    near(center.x, 0.5)
    near(center.y, 0.5)

    const leftBar = mapTouchToContent({
      touch: { x: 0, y: 50 },
      frame,
      video: portrait,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.equal(leftBar, null)

    const leftEdge = mapTouchToContent({
      touch: { x: 51.875, y: 50 },
      frame,
      video: portrait,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.ok(leftEdge)
    near(leftEdge.x, 0)

    const rightEdge = mapTouchToContent({
      touch: { x: 108.125, y: 50 },
      frame,
      video: portrait,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.ok(rightEdge)
    near(rightEdge.x, 1)
  })

  it('letterboxes a landscape video inside a portrait frame', () => {
    const tall = { width: 100, height: 200 }
    const wide = { width: 400, height: 300 }
    const center = mapTouchToContent({
      touch: { x: 50, y: 100 },
      frame: tall,
      video: wide,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.ok(center)
    near(center.x, 0.5)
    near(center.y, 0.5)

    const topBar = mapTouchToContent({
      touch: { x: 50, y: 10 },
      frame: tall,
      video: wide,
      scale: 1,
      pan: { x: 0, y: 0 },
    })
    assert.equal(topBar, null)
  })
})

describe('mapTouchToContent zoom and pan', () => {
  const full = { width: 200, height: 100 }

  it('maps a zoomed view back to the content center', () => {
    const left = mapTouchToContent({
      touch: { x: 0, y: 50 },
      frame: full,
      video: full,
      scale: 2,
      pan: { x: 0, y: 0 },
    })
    assert.ok(left)
    near(left.x, 0.25)
    near(left.y, 0.5)

    const top = mapTouchToContent({
      touch: { x: 100, y: 0 },
      frame: full,
      video: full,
      scale: 2,
      pan: { x: 0, y: 0 },
    })
    assert.ok(top)
    near(top.y, 0.25)
  })

  it('undoes a pan after zoom', () => {
    const center = mapTouchToContent({
      touch: { x: 100, y: 50 },
      frame: full,
      video: full,
      scale: 2,
      pan: { x: 40, y: 0 },
    })
    assert.ok(center)
    near(center.x, 0.4)
    near(center.y, 0.5)
  })

  it('applies zoom and pan after removing the letterbox', () => {
    const mapped = mapTouchToContent({
      touch: { x: 80, y: 50 },
      frame,
      video: landscape,
      scale: 2,
      pan: { x: 0, y: 10 },
    })
    assert.ok(mapped)
    near(mapped.x, 0.5)
    near(mapped.y, 40 / 90)
  })

  it('undoes a 90 degree rotation around the frame center', () => {
    const mapped = mapTouchToContent({
      touch: { x: 150, y: 50 },
      frame: full,
      video: full,
      scale: 1,
      pan: { x: 0, y: 0 },
      rotate: 90,
    })
    assert.ok(mapped)
    near(mapped.x, 0.5)
    near(mapped.y, 0)
  })

  it('ignores a tap in the letterbox instead of clamping to the edge', () => {
    assert.equal(mapTouchToContent({
      touch: { x: 10, y: 50 },
      frame,
      video: portrait,
      scale: 1,
      pan: { x: 0, y: 0 },
    }), null)
    assert.equal(mapTouchToContent({
      touch: { x: -1000, y: 5000 },
      frame: full,
      video: full,
      scale: 1,
      pan: { x: 0, y: 0 },
    }), null)
  })

  it('keeps every mapped point inside 0..1 while zoomed, panned, and rotated', () => {
    for (let i = 0; i < 24; i++) {
      const mapped = mapTouchToContent({
        touch: { x: -50 + i * 20, y: -40 + i * 12 },
        frame,
        video: i % 2 === 0 ? portrait : landscape,
        scale: 1 + (i % 4),
        pan: { x: i * 3 - 20, y: 10 - i },
        rotate: i * 15,
      })
      if (!mapped) continue
      assert.ok(mapped.x >= 0 && mapped.x <= 1)
      assert.ok(mapped.y >= 0 && mapped.y <= 1)
    }
  })

  it('returns null when the video or the touch cannot be mapped', () => {
    const base = {
      touch: { x: 10, y: 10 },
      frame: full,
      video: full,
      scale: 1,
      pan: { x: 0, y: 0 },
    }
    assert.equal(mapTouchToContent({ ...base, video: { width: 0, height: 100 } }), null)
    assert.equal(mapTouchToContent({ ...base, scale: 0 }), null)
    assert.equal(mapTouchToContent({ ...base, touch: { x: Number.NaN, y: 0 } }), null)
  })
})

describe('frame scale', () => {
  it('matches the screen view fit used when the picture is rotated', () => {
    assert.equal(frameScale(1, 0), 1)
    assert.equal(frameScale(1, 180), 1)
    assert.equal(frameScale(2, 90), 2 * 10 / 16)
    assert.equal(frameScale(1, 270), 10 / 16)
  })
})

describe('move throttle', () => {
  it('allows the first move and then at most one per interval', () => {
    assert.equal(moveAllowed(0, null), true)
    assert.equal(moveAllowed(10, 0), false)
    assert.equal(moveAllowed(MOVE_INTERVAL_MS - 0.001, 0), false)
    assert.equal(moveAllowed(MOVE_INTERVAL_MS, 0), true)
  })

  it('keeps a 1ms burst to at most 60 per second', () => {
    let last: number | null = null
    const kept: number[] = []
    for (let t = 0; t <= 1000; t += 1) {
      if (moveAllowed(t, last)) {
        kept.push(t)
        last = t
      }
    }
    assert.ok(kept.length <= 60)
    assert.ok(kept.length >= 58)
    for (let i = 1; i < kept.length; i++) {
      assert.ok(kept[i] - kept[i - 1] >= MOVE_INTERVAL_MS - 1e-9)
    }
    let t = 0
    last = null
    for (let i = 0; i <= 60; i++) {
      assert.equal(moveAllowed(t, last), true)
      last = t
      t += MOVE_INTERVAL_MS
    }
    assert.equal(moveAllowed(last + MOVE_INTERVAL_MS / 2, last), false)
  })
})

describe('control availability copy', () => {
  it('enables control only when sc:avail on is true', () => {
    assert.deepEqual(readAvail(true, 'surface'), { on: true })
    assert.deepEqual(readAvail(false, SC_REASON_HELPER), { on: false, reason: 'helper' })
    assert.deepEqual(readAvail(false, '  '), { on: false })
    assert.deepEqual(readAvail('yes', SC_REASON_SURFACE), { on: false, reason: 'surface' })
  })

  it('shows view-only with the surface hint or the helper reason', () => {
    assert.equal(viewOnlyDetail(undefined), SC_SURFACE_HINT)
    assert.equal(viewOnlyDetail(SC_REASON_SURFACE), SC_SURFACE_HINT)
    assert.equal(viewOnlyDetail(SC_REASON_HELPER), 'Full laptop is off')
    assert.equal(viewOnlyDetail(SC_REASON_EMPTY), SC_EMPTY_HINT)
    assert.equal(viewOnlyDetail('Window share'), 'Window share')
  })
})

function finger(id: number, px: number, py: number, nx = px / 100, ny = py / 100): Finger {
  return { id, px, py, nx, ny }
}

function play(events: GestureEvent[]) {
  let state = initialGesture()
  const effects: Effect[] = []
  for (const ev of events) {
    const step = gestureStep(state, ev)
    state = step.state
    effects.push(...step.effects)
  }
  return { state, effects }
}

function sent(effects: Effect[]) {
  return effects.flatMap((effect) => (effect.type === 'send' ? [effect.msg] : []))
}

describe('control gestures', () => {
  it('sends a click for a tap after the double-tap window', () => {
    const down = finger(1, 40, 50, 0.4, 0.5)
    const { effects } = play([
      { type: 'down', finger: down, now: 0, scale: 1 },
      { type: 'up', id: 1, now: 40, at: down },
      { type: 'clickDue', now: DOUBLE_TAP_MS },
    ])
    assert.deepEqual(sent(effects), [{ t: 'sc', a: 'click', x: 0.4, y: 0.5 }])
  })

  it('sends dbl for a second tap and does not also send click', () => {
    const first = finger(1, 40, 50, 0.4, 0.5)
    const second = finger(1, 42, 51, 0.42, 0.51)
    const { effects } = play([
      { type: 'down', finger: first, now: 0, scale: 1 },
      { type: 'up', id: 1, now: 30, at: first },
      { type: 'down', finger: second, now: 80, scale: 1 },
      { type: 'clickDue', now: 90 },
      { type: 'up', id: 1, now: 120, at: second },
    ])
    assert.deepEqual(sent(effects), [{ t: 'sc', a: 'dbl', x: 0.42, y: 0.51 }])
  })

  it('sends right on a 500ms long-press', () => {
    const held = finger(1, 10, 20, 0.1, 0.2)
    const { effects } = play([
      { type: 'down', finger: held, now: 0, scale: 1 },
      { type: 'long', now: LONG_PRESS_MS },
      { type: 'up', id: 1, now: 560, at: held },
      { type: 'clickDue', now: 600 },
    ])
    assert.deepEqual(sent(effects), [{ t: 'sc', a: 'right', x: 0.1, y: 0.2 }])
  })

  it('sends down, throttled moves, then up for a one-finger drag', () => {
    const origin = finger(1, 0, 0, 0.1, 0.1)
    const mid = finger(1, 30, 0, 0.4, 0.1)
    const later = finger(1, 40, 0, 0.5, 0.1)
    const end = finger(1, 48, 4, 0.6, 0.2)
    const { effects } = play([
      { type: 'down', finger: origin, now: 0, scale: 1 },
      { type: 'move', finger: mid, now: 20, scale: 1 },
      { type: 'move', finger: later, now: 25, scale: 1 },
      { type: 'moveDue', now: 20 + MOVE_INTERVAL_MS },
      { type: 'up', id: 1, now: 80, at: end },
    ])
    const msgs = sent(effects)
    assert.deepEqual(msgs[0], { t: 'sc', a: 'down', x: 0.4, y: 0.1 })
    assert.deepEqual(msgs[1], { t: 'sc', a: 'move', x: 0.4, y: 0.1 })
    assert.equal(msgs.filter((m) => m.a === 'move').length, 2)
    assert.deepEqual(msgs[msgs.length - 1], { t: 'sc', a: 'up', x: 0.6, y: 0.2 })
    assert.equal(msgs.some((m) => m.a === 'click'), false)
  })

  it('sends scroll for a two-finger drag and nothing for a pinch', () => {
    const a0 = finger(1, 20, 40, 0.2, 0.4)
    const b0 = finger(2, 60, 40, 0.6, 0.4)
    const a1 = finger(1, 20, 70, 0.2, 0.7)
    const b1 = finger(2, 60, 70, 0.6, 0.7)
    const scrolled = play([
      { type: 'down', finger: a0, now: 0, scale: 1 },
      { type: 'down', finger: b0, now: 5, scale: 1 },
      { type: 'move', finger: a1, now: 30, scale: 1 },
      { type: 'move', finger: b1, now: 30, scale: 1 },
    ])
    const scrolls = sent(scrolled.effects)
    assert.ok(scrolls.length > 0)
    assert.ok(scrolls.every((m) => m.t === 'sc' && m.a === 'scroll'))
    assert.equal(scrolls.reduce((sum, m) => sum + (m.a === 'scroll' ? m.dx : 0), 0), 0)
    assert.equal(scrolls.reduce((sum, m) => sum + (m.a === 'scroll' ? m.dy : 0), 0), 30)

    const pinchA = finger(1, 30, 40, 0.3, 0.4)
    const pinchB = finger(2, 90, 40, 0.9, 0.4)
    const pinched = play([
      { type: 'down', finger: a0, now: 0, scale: 1.5 },
      { type: 'down', finger: b0, now: 5, scale: 1.5 },
      { type: 'move', finger: pinchA, now: 40, scale: 1.5 },
      { type: 'move', finger: pinchB, now: 40, scale: 1.5 },
    ])
    assert.deepEqual(sent(pinched.effects), [])
    const zoom = pinched.effects.find((effect) => effect.type === 'zoom')
    assert.ok(zoom && zoom.type === 'zoom')
    assert.ok(zoom.scale > 1.5)
    assert.ok(zoom.scale <= 5)
  })

  it('sends nothing when a drag is cancelled after stop', () => {
    const origin = finger(1, 0, 0, 0.2, 0.2)
    const mid = finger(1, 24, 0, 0.5, 0.2)
    const { effects, state } = play([
      { type: 'down', finger: origin, now: 0, scale: 1 },
      { type: 'move', finger: mid, now: 16, scale: 1 },
      { type: 'cancel', now: 40, quiet: true },
    ])
    assert.equal(sent(effects).some((m) => m.a === 'up'), false)
    assert.equal(state.phase, 'idle')
  })

  it('releases a held button when control is cancelled', () => {
    const origin = finger(1, 0, 0, 0.2, 0.2)
    const mid = finger(1, 24, 0, 0.5, 0.2)
    const { effects, state } = play([
      { type: 'down', finger: origin, now: 0, scale: 1 },
      { type: 'move', finger: mid, now: 16, scale: 1 },
      { type: 'cancel', now: 40 },
    ])
    const msgs = sent(effects)
    assert.equal(msgs[msgs.length - 1].a, 'up')
    assert.equal(state.phase, 'idle')
    const idle: GestureState = initialGesture()
    assert.equal(state.fingers.length, idle.fingers.length)
  })
})
