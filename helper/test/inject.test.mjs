import assert from 'node:assert/strict'
import test from 'node:test'
import { createNutInjector, createPointerController, mapAbs, nutScrollName, playStrokes, scrollPlan, strokesForText } from '../dist/inject.js'

test('mapAbs uses primary-display size and stays on the last pixel', () => {
  assert.deepEqual(mapAbs(0, 0, 1920, 1080), { x: 0, y: 0 })
  assert.deepEqual(mapAbs(1, 1, 1920, 1080), { x: 1919, y: 1079 })
  assert.deepEqual(mapAbs(0.5, 0.5, 1920, 1080), { x: 960, y: 540 })
  assert.deepEqual(mapAbs(0.25, 0.75, 800, 600), { x: 200, y: 450 })
  assert.deepEqual(mapAbs(-1, 4, 100, 50), { x: 0, y: 49 })
  assert.deepEqual(mapAbs(0.5, 0.5, 0, -10), { x: 0, y: 0 })
  assert.deepEqual(mapAbs(Number.NaN, Number.POSITIVE_INFINITY, 1440, 900), { x: 0, y: 0 })
  assert.deepEqual(mapAbs(1, 0, 1, 1), { x: 0, y: 0 })
})

function driver() {
  const events = []
  return {
    events,
    async size() { return { width: 200, height: 100 } },
    async moveTo(x, y) { events.push(['move', x, y]) },
    async press(btn) { events.push(['press', btn]) },
    async release(btn) { events.push(['release', btn]) },
    async doubleClick() { events.push(['dbl']) },
  }
}

test('a drag holds one button and release lets go of only that button', async () => {
  const io = driver()
  const pointer = createPointerController(io)
  await pointer.abs(1, 0.5)
  await pointer.btn('left', 'down')
  await pointer.abs(0, 0)
  await pointer.btn('right', 'up')
  await pointer.release()
  await pointer.release()
  assert.equal(pointer.held(), null)
  assert.deepEqual(io.events, [
    ['move', 199, 50],
    ['press', 'left'],
    ['move', 0, 0],
    ['release', 'left'],
  ])
})

test('positive dx scrolls right and positive dy scrolls down', () => {
  assert.deepEqual(scrollPlan(120, 0), [{ dir: 'right', steps: 3 }])
  assert.deepEqual(scrollPlan(-120, 0), [{ dir: 'left', steps: 3 }])
  assert.deepEqual(scrollPlan(0, 120), [{ dir: 'down', steps: 3 }])
  assert.deepEqual(scrollPlan(0, -80), [{ dir: 'up', steps: 2 }])
  assert.deepEqual(scrollPlan(10, -10), [{ dir: 'up', steps: 1 }, { dir: 'right', steps: 1 }])
  assert.deepEqual(scrollPlan(0, 0), [])
  assert.equal(nutScrollName('right', 'darwin'), 'scrollRight')
  assert.equal(nutScrollName('left', 'darwin'), 'scrollLeft')
  assert.equal(nutScrollName('down', 'darwin'), 'scrollDown')
  // Linux scrollRight posts X11 button 6 (left). Button 7 (right) is scrollLeft.
  assert.equal(nutScrollName('right', 'linux'), 'scrollLeft')
  assert.equal(nutScrollName('left', 'linux'), 'scrollRight')
  assert.equal(nutScrollName('down', 'linux'), 'scrollDown')
  assert.equal(nutScrollName('up', 'linux'), 'scrollUp')
  assert.equal(nutScrollName('right', 'win32'), 'scrollLeft')
  assert.equal(nutScrollName('left', 'win32'), 'scrollRight')
})

test('a left click is one press and one release', async () => {
  const calls = []
  const inject = createNutInjector({
    async tap() {},
    async typeChar() {},
  }, {
    click: {
      async press(btn) { calls.push(['press', btn]) },
      async release(btn) { calls.push(['release', btn]) },
    },
  })
  await inject.click('left')
  await inject.click('right')
  assert.deepEqual(calls, [
    ['press', 'left'],
    ['release', 'left'],
    ['press', 'right'],
    ['release', 'right'],
  ])
})

test('one typed character, Enter, and Backspace are each one keystroke', async () => {
  assert.deepEqual(strokesForText('ab'), [{ op: 'char', ch: 'a' }, { op: 'char', ch: 'b' }])
  assert.deepEqual(strokesForText('a\n'), [{ op: 'char', ch: 'a' }, { op: 'tap', names: ['Return'] }])
  const calls = []
  const port = {
    async tap(names) { calls.push(['tap', ...names]) },
    async typeChar(ch) { calls.push(['char', ch]) },
  }
  await playStrokes(port, 'Hi')
  await playStrokes(port, '\n')
  const inject = createNutInjector(port)
  await inject.type('ab')
  await inject.type('c\n')
  await inject.key('Enter', [])
  await inject.key('Backspace', [])
  assert.deepEqual(calls, [
    ['char', 'H'],
    ['char', 'i'],
    ['tap', 'Return'],
    ['char', 'a'],
    ['char', 'b'],
    ['char', 'c'],
    ['tap', 'Return'],
    ['tap', 'Return'],
    ['tap', 'Backspace'],
  ])
})

test('double-click releases a held button before the click', async () => {
  const io = driver()
  const pointer = createPointerController(io)
  await pointer.btn('right', 'down')
  await pointer.dbl()
  await pointer.btn('left', 'up')
  assert.deepEqual(io.events, [
    ['press', 'right'],
    ['release', 'right'],
    ['dbl'],
  ])
})
