import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_REMOTE_TOOLBAR_MODE,
  remotePointerLaserOnForMode,
  remoteTapSendsClick,
  remoteToolbarShowsClicks,
  remoteToolbarShowsNav,
} from './remoteToolbar.ts'

describe('remoteToolbar mode', () => {
  it('defaults to cursor mode', () => {
    assert.equal(DEFAULT_REMOTE_TOOLBAR_MODE, 'cursor')
  })

  it('shows click buttons only in cursor mode', () => {
    assert.equal(remoteToolbarShowsClicks('cursor'), true)
    assert.equal(remoteToolbarShowsClicks('pointer'), false)
    assert.equal(remoteToolbarShowsNav('pointer'), true)
    assert.equal(remoteToolbarShowsNav('cursor'), false)
  })

  it('enables laser and disables tap-click in pointer mode', () => {
    assert.equal(remotePointerLaserOnForMode('cursor'), false)
    assert.equal(remotePointerLaserOnForMode('pointer'), true)
    assert.equal(remoteTapSendsClick('cursor'), true)
    assert.equal(remoteTapSendsClick('pointer'), false)
  })
})
