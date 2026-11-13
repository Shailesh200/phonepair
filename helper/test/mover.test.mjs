import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createMover, nudgeTargets, performNudge } from '../dist/mover.js'

function fakeClock() {
  /** @type {{ fn: () => void, ms: number, left: number }[]} */
  const timers = []
  return {
    setTimer(fn, ms) {
      const timer = { fn, ms, left: ms }
      timers.push(timer)
      return timer
    },
    clearTimer(timer) {
      const index = timers.indexOf(timer)
      if (index >= 0) timers.splice(index, 1)
    },
    pending() { return timers.length },
    tick(ms) {
      let left = ms
      let guard = 0
      while (left > 0 && timers.length && guard < 100000) {
        guard += 1
        const step = Math.min(left, ...timers.map((timer) => timer.left))
        for (const timer of timers) timer.left -= step
        left -= step
        const due = timers.filter((timer) => timer.left <= 0)
        for (const timer of due) {
          timer.left += timer.ms
          timer.fn()
        }
      }
    },
  }
}

function harness() {
  const clock = fakeClock()
  const nudges = []
  const mover = createMover({
    nudge: () => { nudges.push(nudges.length + 1) },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  return { clock, nudges, mover }
}

test('nudge reads the point, steps +1/+2, and names the original point', () => {
  assert.deepEqual(nudgeTargets({ x: 10, y: 20 }), { away: { x: 11, y: 22 }, home: { x: 10, y: 20 } })
  assert.deepEqual(nudgeTargets({ x: 10.4, y: 4.6 }), { away: { x: 11, y: 7 }, home: { x: 10, y: 5 } })
  assert.deepEqual(nudgeTargets({ x: -1.2, y: 0 }), { away: { x: 0, y: 2 }, home: { x: -1, y: 0 } })
})

test('a nudge returns home, and skips the return when the user moved the cursor', async () => {
  const still = []
  let pos = { x: 10, y: 20 }
  await performNudge({
    async getPosition() { return { ...pos } },
    async setPosition(x, y) {
      still.push([x, y])
      pos = { x, y }
    },
  })
  assert.deepEqual(still, [[11, 22], [10, 20]])

  const moved = []
  let reads = 0
  await performNudge({
    async getPosition() {
      reads += 1
      return reads === 1 ? { x: 10, y: 20 } : { x: 80, y: 90 }
    },
    async setPosition(x, y) { moved.push([x, y]) },
  })
  assert.deepEqual(moved, [[11, 22]])
})

test('3s is the nudge interval the page sends', () => {
  const { clock, nudges, mover } = harness()
  assert.deepEqual(mover.start('3s'), { on: true, interval: '3s' })
  clock.tick(2_999)
  assert.equal(nudges.length, 0)
  clock.tick(1)
  assert.equal(nudges.length, 1)
  clock.tick(3_000)
  assert.equal(nudges.length, 2)
  assert.equal(clock.pending(), 1)
})

test('fake timers: 30s, 1m, and 5m nudge on that interval and nothing else is accepted', () => {
  const { clock, nudges, mover } = harness()
  assert.equal(mover.start('10s'), null)
  assert.equal(mover.start('2m'), null)
  assert.equal(mover.start('1min'), null)
  assert.equal(mover.start(60_000), null)
  assert.equal(mover.start('30'), null)
  assert.deepEqual(mover.state(), { on: false, interval: null })
  assert.equal(clock.pending(), 0)
  clock.tick(300_000)
  assert.equal(nudges.length, 0)

  assert.deepEqual(mover.start('30s'), { on: true, interval: '30s' })
  assert.equal(clock.pending(), 1)
  clock.tick(29_999)
  assert.equal(nudges.length, 0)
  clock.tick(1)
  assert.equal(nudges.length, 1)
  clock.tick(30_000)
  assert.equal(nudges.length, 2)

  assert.deepEqual(mover.start('1m'), { on: true, interval: '1m' })
  assert.equal(clock.pending(), 1, 'changing interval keeps a single timer')
  clock.tick(30_000)
  assert.equal(nudges.length, 2, 'the old 30s timer does not keep firing')
  clock.tick(30_000)
  assert.equal(nudges.length, 3)

  assert.deepEqual(mover.start('5m'), { on: true, interval: '5m' })
  clock.tick(299_999)
  assert.equal(nudges.length, 3)
  clock.tick(1)
  assert.equal(nudges.length, 4)
  assert.equal(clock.pending(), 1)
})

test('each tick moves the pointer away and back, and a new interval re-arms', async () => {
  const clock = fakeClock()
  const moves = []
  let pos = { x: 10, y: 20 }
  const mouse = {
    async getPosition() { return { x: pos.x, y: pos.y } },
    async setPosition(x, y) {
      moves.push([x, y])
      pos = { x, y }
    },
  }
  const mover = createMover({
    nudge: () => performNudge(mouse, { dwellMs: 0 }),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  const flush = () => new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(mover.start('30s'), { on: true, interval: '30s' })
  clock.tick(29_999)
  await flush()
  assert.equal(moves.length, 0)
  clock.tick(1)
  await flush()
  clock.tick(30_000)
  await flush()
  clock.tick(30_000)
  await flush()
  assert.deepEqual(moves, [
    [11, 22], [10, 20],
    [11, 22], [10, 20],
    [11, 22], [10, 20],
  ])
  assert.deepEqual(mover.start('30s'), { on: true, interval: '30s' })
  assert.deepEqual(mover.start('1m'), { on: true, interval: '1m' })
  clock.tick(30_000)
  await flush()
  assert.equal(moves.length, 6, 'the restarted timer does not keep the old 30s phase')
  clock.tick(30_000)
  await flush()
  assert.deepEqual(moves.slice(6), [[11, 22], [10, 20]])
  assert.equal(clock.pending(), 1)
})

test('stop clears the only timer', () => {
  const { clock, nudges, mover } = harness()
  mover.start('30s')
  clock.tick(30_000)
  assert.equal(nudges.length, 1)
  assert.deepEqual(mover.stop(), { on: false, interval: null })
  assert.equal(clock.pending(), 0)
  clock.tick(300_000)
  assert.equal(nudges.length, 1)
  assert.deepEqual(mover.state(), { on: false, interval: null })
  mover.stop()
  assert.equal(clock.pending(), 0)
})

test('quit hooks stop the mover on exit, SIGINT, SIGTERM, and before-quit', () => {
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../../desktop/src/main.ts', import.meta.url), 'utf8')
  assert.match(index, /process\.on\('exit'[\s\S]*stopMover\(\)/)
  assert.match(index, /process\.on\('SIGINT'/)
  assert.match(index, /process\.on\('SIGTERM'/)
  assert.match(main, /before-quit[\s\S]*stopMover\(\)/)
  assert.match(main, /process\.on\('exit'[\s\S]*stopMover\(\)/)
})
