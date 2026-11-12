import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HOST_FORCE_HOOK_MIN_MS, mayHostForceHook } from './hostForceHookThrottle.ts'

describe('host force hook throttle', () => {
  it('blocks while the runner is busy or inside the min gap', () => {
    const t0 = 1000
    assert.equal(mayHostForceHook(t0, 0, false), true)
    assert.equal(mayHostForceHook(t0 + 100, t0, false), false)
    assert.equal(mayHostForceHook(t0 + HOST_FORCE_HOOK_MIN_MS, t0, false), true)
    assert.equal(mayHostForceHook(t0 + HOST_FORCE_HOOK_MIN_MS, t0, true), false)
  })
})
