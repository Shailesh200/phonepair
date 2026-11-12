import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  shouldDeferListenBootstrapWhileOffline,
  shouldHostArmListenIdRecovery,
  shouldHostRememberSignalWork,
} from './rememberListenRecoveryGate.ts'

describe('shouldHostArmListenIdRecovery', () => {
  it('arms only when this tab owned the listen id and did not give up', () => {
    assert.equal(
      shouldHostArmListenIdRecovery({
        hasRememberPhones: true,
        listenOwnedBefore: true,
        listenGaveUp: false,
      }),
      true,
    )
    assert.equal(
      shouldHostArmListenIdRecovery({
        hasRememberPhones: true,
        listenOwnedBefore: false,
        listenGaveUp: false,
      }),
      false,
    )
    assert.equal(
      shouldHostArmListenIdRecovery({
        hasRememberPhones: true,
        listenOwnedBefore: true,
        listenGaveUp: true,
      }),
      false,
    )
    assert.equal(
      shouldHostArmListenIdRecovery({
        hasRememberPhones: false,
        listenOwnedBefore: true,
        listenGaveUp: false,
      }),
      false,
    )
  })
})

describe('listen bootstrap offline', () => {
  it('defers bootstrap while offline and resumes work when online', () => {
    assert.equal(shouldDeferListenBootstrapWhileOffline(false), true)
    assert.equal(shouldDeferListenBootstrapWhileOffline(true), false)
    assert.equal(shouldHostRememberSignalWork(true, false), true)
    assert.equal(shouldHostRememberSignalWork(true, true), false)
    assert.equal(shouldHostRememberSignalWork(false, false), false)
  })
})
