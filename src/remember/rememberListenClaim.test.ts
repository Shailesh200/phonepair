import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  REMEMBER_LISTEN_BURST_WINDOW_MS,
  canOpenRememberListenSocket,
  listenUnavailableBurstCapReached,
} from './rememberListenClaim.ts'

describe('remember listen claim burst', () => {
  it('counts only unavailable-id failures in the 10s burst window', () => {
    const t0 = 1000
    assert.equal(listenUnavailableBurstCapReached([], t0 + 100, false), false)
    assert.equal(
      listenUnavailableBurstCapReached([t0, t0 + 100, t0 + 200], t0 + 500, false),
      true,
    )
    assert.equal(
      listenUnavailableBurstCapReached([t0, t0 + 100, t0 + 200], t0 + REMEMBER_LISTEN_BURST_WINDOW_MS + 1, false),
      false,
    )
    assert.equal(listenUnavailableBurstCapReached([t0, t0 + 100], t0 + 500, true), false)
    assert.equal(canOpenRememberListenSocket(false, [t0, t0 + 100], t0 + 300, false), true)
    assert.equal(canOpenRememberListenSocket(false, [t0, t0 + 100, t0 + 200], t0 + 300, false), false)
  })
})
