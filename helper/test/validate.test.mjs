import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_DELTA,
  MAX_TEXT,
  canonicalKey,
  clampDelta,
  clampUnit,
  originAllowed,
  parseInput,
  parsePair,
} from '../dist/validate.js'

test('origins are an exact allowlist', () => {
  assert.equal(originAllowed('https://phonepair.vercel.app'), true)
  assert.equal(originAllowed('http://localhost:5173'), true)
  for (const origin of [
    undefined,
    null,
    '',
    'https://phonepair.vercel.app/',
    'https://phonepair.vercel.app.evil.test',
    'http://phonepair.vercel.app',
    'https://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://localhost:5173/',
    'null',
  ]) {
    assert.equal(originAllowed(origin), false, String(origin))
  }
})

test('deltas clamp and reject non-numbers', () => {
  assert.equal(clampDelta(12), 12)
  assert.equal(clampDelta(MAX_DELTA + 50), MAX_DELTA)
  assert.equal(clampDelta(-MAX_DELTA - 1), -MAX_DELTA)
  assert.equal(clampDelta(-0), 0)
  const big = parseInput({ t: 'move', dx: 99999, dy: -99999 })
  assert.equal(big.ok, true)
  assert.deepEqual(big.msg, { t: 'move', dx: MAX_DELTA, dy: -MAX_DELTA })
  const scroll = parseInput({ t: 'scroll', dx: 10.5, dy: -3 })
  assert.deepEqual(scroll.msg, { t: 'scroll', dx: 10.5, dy: -3 })
  for (const bad of [
    { t: 'move', dx: '10', dy: 1 },
    { t: 'move', dx: Infinity, dy: 1 },
    { t: 'move', dx: NaN, dy: 1 },
    { t: 'move', dx: 1 },
    { t: 'scroll', dx: 1, dy: null },
    { t: 'move', dx: 1, dy: 2, extra: { shell: 'id' } },
  ]) {
    const parsed = parseInput(bad)
    if (bad.extra) {
      assert.equal(parsed.ok, true)
      assert.deepEqual(parsed.msg, { t: 'move', dx: 1, dy: 2 })
    } else {
      assert.equal(parsed.ok, false, JSON.stringify(bad))
    }
  }
})

test('clicks are left or right only', () => {
  assert.deepEqual(parseInput({ t: 'click', btn: 'left' }).msg, { t: 'click', btn: 'left' })
  assert.deepEqual(parseInput({ t: 'click', btn: 'right' }).msg, { t: 'click', btn: 'right' })
  for (const btn of ['middle', 'LEFT', 0, '', null]) {
    assert.equal(parseInput({ t: 'click', btn }).ok, false, String(btn))
  }
})

test('key allowlist covers arrows, editing keys, space, printable chars, and modifiers', () => {
  const named = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Escape', 'Tab', 'Backspace', 'Space', 'PageUp', 'PageDown']
  for (const key of named) {
    assert.equal(canonicalKey(key), key)
    assert.equal(parseInput({ t: 'key', key }).ok, true)
  }
  assert.equal(canonicalKey(' '), 'Space')
  assert.equal(canonicalKey('Esc'), 'Escape')
  assert.deepEqual(parseInput({ t: 'key', key: ' ' }).msg, { t: 'key', key: 'Space', mods: [] })
  assert.deepEqual(parseInput({ t: 'key', key: 'Esc' }).msg, { t: 'key', key: 'Escape', mods: [] })
  for (const key of ['a', 'Z', '7', '!', 'é', '…']) {
    assert.equal(canonicalKey(key), key)
  }
  const withMods = parseInput({ t: 'key', key: 'c', mods: ['cmd', 'shift'] })
  assert.deepEqual(withMods.msg, { t: 'key', key: 'c', mods: ['cmd', 'shift'] })
  const deduped = parseInput({ t: 'key', key: 'Tab', mods: ['ctrl', 'ctrl', 'alt'] })
  assert.deepEqual(deduped.msg.mods, ['ctrl', 'alt'])
  for (const mod of ['cmd', 'ctrl', 'alt', 'shift']) {
    assert.equal(parseInput({ t: 'key', key: mod }).ok, true)
  }
})

test('keys and commands outside the allowlist are dropped', () => {
  for (const key of ['F1', 'Delete', 'Home', 'Enter\n', 'ArrowUp;id', 'rm -rf /', 'Meta', 'super', 'Control', 'a'.repeat(33), '', 'ab']) {
    assert.equal(parseInput({ t: 'key', key }).ok, false, JSON.stringify(key))
  }
  assert.equal(parseInput({ t: 'key', key: 'a', mods: ['super'] }).ok, false)
  assert.equal(parseInput({ t: 'key', key: 'a', mods: 'ctrl' }).ok, false)
  assert.equal(parseInput({ t: 'key', key: 'a', mods: ['ctrl', 'alt', 'shift', 'cmd', 'ctrl'] }).ok, false)
  assert.equal(parseInput({ t: 'key', key: 'a\u0000' }).ok, false)
  assert.equal(parseInput({ t: 'exec', cmd: 'id' }).ok, false)
  assert.equal(parseInput({ t: 'shell', command: 'ls' }).ok, false)
  assert.equal(parseInput(['move', 1, 2]).ok, false)
  assert.equal(parseInput(null).ok, false)
  assert.equal(parseInput('move').ok, false)
})

test('typed text must be printable and bounded', () => {
  assert.deepEqual(parseInput({ t: 'type', text: 'Hello 1!' }).msg, { t: 'type', text: 'Hello 1!' })
  assert.equal(parseInput({ t: 'type', text: 'émoji ✨' }).ok, true)
  assert.equal(parseInput({ t: 'type', text: '' }).ok, false)
  assert.equal(parseInput({ t: 'type', text: 'a\nb' }).ok, false)
  assert.equal(parseInput({ t: 'type', text: 'a\tb' }).ok, false)
  assert.equal(parseInput({ t: 'type', text: 'a\u007fb' }).ok, false)
  assert.equal(parseInput({ t: 'type', text: 'x'.repeat(MAX_TEXT) }).ok, true)
  assert.equal(parseInput({ t: 'type', text: 'x'.repeat(MAX_TEXT + 1) }).ok, false)
  assert.equal(parseInput({ t: 'type', text: 12 }).ok, false)
})

test('absolute points clamp into 0..1 and reject bad numbers', () => {
  assert.equal(clampUnit(0.25), 0.25)
  assert.equal(clampUnit(-0.4), 0)
  assert.equal(clampUnit(1.7), 1)
  assert.equal(clampUnit(-0), 0)
  assert.deepEqual(parseInput({ t: 'abs', x: 0, y: 1 }).msg, { t: 'abs', x: 0, y: 1 })
  assert.deepEqual(parseInput({ t: 'abs', x: -4, y: 3.2 }).msg, { t: 'abs', x: 0, y: 1 })
  assert.deepEqual(parseInput({ t: 'abs', x: 0.5, y: 0.25, shell: 'id' }).msg, { t: 'abs', x: 0.5, y: 0.25 })
  for (const bad of [
    { t: 'abs', x: '0.2', y: 0.2 },
    { t: 'abs', x: NaN, y: 0.2 },
    { t: 'abs', x: Infinity, y: 0.2 },
    { t: 'abs', x: 0.2, y: null },
    { t: 'abs', x: 0.2 },
    { t: 'abs', y: 0.2 },
    { t: 'abs' },
  ]) {
    assert.equal(parseInput(bad).ok, false, JSON.stringify(bad))
  }
})

test('button drags are left or right, down or up, and double-click is empty', () => {
  assert.deepEqual(parseInput({ t: 'btn', btn: 'left', state: 'down' }).msg, { t: 'btn', btn: 'left', state: 'down' })
  assert.deepEqual(parseInput({ t: 'btn', btn: 'right', state: 'up' }).msg, { t: 'btn', btn: 'right', state: 'up' })
  assert.deepEqual(parseInput({ t: 'dbl', extra: true }).msg, { t: 'dbl' })
  for (const bad of [
    { t: 'btn', btn: 'middle', state: 'down' },
    { t: 'btn', btn: 'LEFT', state: 'down' },
    { t: 'btn', btn: 'left', state: 'DOWN' },
    { t: 'btn', btn: 'left', state: 'click' },
    { t: 'btn', btn: 'left' },
    { t: 'btn', state: 'down' },
    { t: 'btn', btn: 0, state: 'down' },
    { t: 'dbl', x: NaN },
  ]) {
    if (bad.t === 'dbl') {
      assert.equal(parseInput(bad).ok, true)
      assert.deepEqual(parseInput(bad).msg, { t: 'dbl' })
    } else {
      assert.equal(parseInput(bad).ok, false, JSON.stringify(bad))
    }
  }
  assert.equal(parseInput({ t: 'abs' }).ok, false)
  assert.equal(parseInput({ t: 'file', path: '/etc/passwd' }).ok, false)
  assert.equal(parseInput({ t: 'shell', command: 'open' }).ok, false)
})

test('the first message must be a 6-digit pair code', () => {
  assert.deepEqual(parsePair({ t: 'pair', code: '042817' }).msg, { t: 'pair', code: '042817' })
  for (const value of [
    { t: 'pair', code: '12345' },
    { t: 'pair', code: '1234567' },
    { t: 'pair', code: 'abcdef' },
    { t: 'pair', code: '12345 ' },
    { t: 'pair', code: 123456 },
    { t: 'hello', code: '123456' },
    { code: '123456' },
    { t: 'pair' },
    null,
  ]) {
    assert.equal(parsePair(value).ok, false, JSON.stringify(value))
  }
})
