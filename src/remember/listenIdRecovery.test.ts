import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LISTEN_RECOVERY_RECLAIM_MAX_MS,
  listenBackoffForClaim,
  listenClaimShouldGiveUp,
} from './listenIdRecovery.ts'
import { listenReclaimIdBackoffMs } from './listenIdReclaim.ts'

const t0 = 1_700_000_000_000

test('recovery mode keeps reclaiming unavailable-id past normal 75s cap', () => {
  assert.equal(
    listenClaimShouldGiveUp(5, 10, true, t0, t0 + 76_000, true),
    false,
  )
  assert.equal(
    listenClaimShouldGiveUp(5, 10, true, t0, t0 + LISTEN_RECOVERY_RECLAIM_MAX_MS - 1, true),
    false,
  )
  assert.equal(
    listenClaimShouldGiveUp(5, 10, true, t0, t0 + LISTEN_RECOVERY_RECLAIM_MAX_MS, true),
    true,
  )
})

test('recovery backoff is fixed 2.5s while reclaiming owned id', () => {
  assert.equal(
    listenBackoffForClaim(3, true, t0, listenReclaimIdBackoffMs, true),
    2500,
  )
})

test('non-recovery still uses standard give-up', () => {
  assert.equal(listenClaimShouldGiveUp(2, 1, false, null, 0, false), true)
})

test('recovery unavailable-id reconnect stops at 120s ID-taken reclaim cap', () => {
  const reclaimAt = t0
  const atCap = reclaimAt + LISTEN_RECOVERY_RECLAIM_MAX_MS
  assert.equal(listenClaimShouldGiveUp(3, 2, true, reclaimAt, atCap - 1, true), false)
  assert.equal(listenClaimShouldGiveUp(3, 2, true, reclaimAt, atCap, true), true)
})
