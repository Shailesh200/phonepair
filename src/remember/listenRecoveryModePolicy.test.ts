import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  listenForceTickResumesAfterRecoverySettle,
  listenRecoveryModeBlocksListenForce,
  planListenRecoveryOnServerOpen,
} from './listenRecoveryModePolicy.ts'
import { FORCE_LISTEN_SETTLE_MS } from './listenForceSettle.ts'

describe('listen recovery mode policy', () => {
  it('blocks listen force tick and nudge while recovery mode is set', () => {
    assert.equal(listenRecoveryModeBlocksListenForce(true), true)
    assert.equal(listenRecoveryModeBlocksListenForce(false), false)
  })

  it('listen OPEN with no phone: ticks resume after settle', () => {
    const openAt = 50_000
    const plan = planListenRecoveryOnServerOpen(true, openAt, openAt + 120_000)
    assert.equal(plan.endUnverifiedForcing, true)
    assert.equal(plan.settleUntil, openAt + FORCE_LISTEN_SETTLE_MS)
    assert.equal(plan.clearRecoveryModeAt, openAt + FORCE_LISTEN_SETTLE_MS)

    const clearAt = plan.clearRecoveryModeAt!
    assert.equal(
      listenForceTickResumesAfterRecoverySettle(true, clearAt - 1, clearAt),
      false,
    )
    assert.equal(
      listenForceTickResumesAfterRecoverySettle(true, clearAt, clearAt),
      true,
    )
    assert.equal(listenForceTickResumesAfterRecoverySettle(false, clearAt, clearAt), true)
  })
})
