import assert from 'node:assert/strict'
import test from 'node:test'
import { planKey } from '../dist/keys.js'

test('named keys and modifiers become taps', () => {
  assert.deepEqual(planKey('ArrowLeft', []), { kind: 'tap', keys: ['Left'] })
  assert.deepEqual(planKey('Enter', ['cmd']), { kind: 'tap', keys: ['LeftCmd', 'Enter'] })
  assert.deepEqual(planKey('Escape', []), { kind: 'tap', keys: ['Escape'] })
  assert.deepEqual(planKey('Tab', ['ctrl', 'shift']), { kind: 'tap', keys: ['LeftControl', 'LeftShift', 'Tab'] })
  assert.deepEqual(planKey('Backspace', []), { kind: 'tap', keys: ['Backspace'] })
  assert.deepEqual(planKey('Space', ['alt']), { kind: 'tap', keys: ['LeftAlt', 'Space'] })
  assert.deepEqual(planKey('PageDown', []), { kind: 'tap', keys: ['PageDown'] })
  assert.deepEqual(planKey('ctrl', []), { kind: 'tap', keys: ['LeftControl'] })
  assert.deepEqual(planKey('cmd', ['shift']), { kind: 'tap', keys: ['LeftShift', 'LeftCmd'] })
})

test('printable characters type, and letters with modifiers become shortcuts', () => {
  assert.deepEqual(planKey('a', []), { kind: 'type', text: 'a', mods: [] })
  assert.deepEqual(planKey('A', []), { kind: 'type', text: 'A', mods: [] })
  assert.deepEqual(planKey('!', []), { kind: 'type', text: '!', mods: [] })
  assert.deepEqual(planKey('c', ['cmd']), { kind: 'tap', keys: ['LeftCmd', 'C'] })
  assert.deepEqual(planKey('C', ['ctrl']), { kind: 'tap', keys: ['LeftControl', 'LeftShift', 'C'] })
  assert.deepEqual(planKey('C', ['shift']), { kind: 'tap', keys: ['LeftShift', 'C'] })
  assert.deepEqual(planKey('5', ['alt']), { kind: 'tap', keys: ['LeftAlt', 'Num5'] })
  assert.deepEqual(planKey('é', ['ctrl']), { kind: 'type', text: 'é', mods: ['ctrl'] })
  assert.equal(planKey('nope', []), null)
})
