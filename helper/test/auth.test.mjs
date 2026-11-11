import assert from 'node:assert/strict'
import test from 'node:test'
import { LOCK_MS, MAX_ATTEMPTS, codesMatch, createGate, isLocked, noteFailure, noteSuccess } from '../dist/auth.js'
import { ACCESSIBILITY_HELP, probeAccessibility, probeInput } from '../dist/permission.js'

test('pairing codes match in constant time only when equal', () => {
  assert.equal(codesMatch('042817', '042817'), true)
  assert.equal(codesMatch('042817', '042818'), false)
  assert.equal(codesMatch('042817', '04281'), false)
  assert.equal(codesMatch('', ''), false)
})

test('five bad codes lock pairing for 60 seconds', () => {
  const gate = createGate()
  const start = 1_000_000
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) noteFailure(gate, start)
  assert.equal(isLocked(gate, start), false)
  assert.equal(gate.attempts, MAX_ATTEMPTS - 1)
  noteFailure(gate, start)
  assert.equal(isLocked(gate, start), true)
  assert.equal(gate.lockedUntil, start + LOCK_MS)
  const attempts = gate.attempts
  noteFailure(gate, start + 10)
  assert.equal(gate.attempts, attempts)
  assert.equal(isLocked(gate, start + LOCK_MS - 1), true)
  assert.equal(isLocked(gate, start + LOCK_MS), false)
  assert.equal(gate.attempts, 0)
})

test('a correct code clears the attempt counter', () => {
  const gate = createGate()
  noteFailure(gate, 10)
  noteFailure(gate, 10)
  noteSuccess(gate)
  assert.equal(gate.attempts, 0)
  assert.equal(isLocked(gate, 10), false)
})

test('accessibility instructions name the macOS settings path', async () => {
  assert.match(ACCESSIBILITY_HELP, /System Settings > Privacy & Security > Accessibility/)
  assert.equal(await probeAccessibility(async () => {}), true)
  assert.equal(await probeAccessibility(async () => { throw new Error('not allowed') }), false)
  assert.equal(await probeInput(async () => {}), true)
  assert.equal(await probeInput(async () => { throw new Error('denied') }), false)
})
