import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { assertPpDebugHasNoIds, ppDebugStringLooksLikeId } from './ppDebugNoIds.ts'
import { ensurePpDebug, ppDebug } from './ppDebug.ts'
import {
  ppDebugRememberAuthSent,
  ppDebugRememberDial,
  ppDebugRememberDialError,
} from './ppDebugRemember.ts'
import { ppDebugRecordGuestRedial } from './ppDebug.ts'
import { ppDebugRecordDataConnected, ppDebugRecordIceTransport } from './ppDebugIce.ts'

describe('ppDebug has no ids', () => {
  it('rejects strings that look like peer ids or pairing codes', () => {
    assert.equal(ppDebugStringLooksLikeId('host'), false)
    assert.equal(ppDebugStringLooksLikeId('relay'), false)
    assert.equal(ppDebugStringLooksLikeId('peer-unavailable'), false)
    assert.ok(ppDebugStringLooksLikeId('phonepair-listen-abc123'))
    assert.ok(ppDebugStringLooksLikeId('ABCDEF'))
    assert.ok(ppDebugStringLooksLikeId('phonep…c123'))
  })

  it('fresh __ppDebug and common updates stay id-free', () => {
    ensurePpDebug()
    const d = ppDebug()
    assertPpDebugHasNoIds(d)
    ppDebugRememberDial('phonepair-wz8cnc-listen-deadbeef')
    ppDebugRememberDial('phonepair-other-listen-deadbeef')
    ppDebugRememberDialError('peer-unavailable')
    ppDebugRememberAuthSent()
    ppDebugRecordGuestRedial(800)
    ppDebugRecordGuestRedial(0)
    const gen = ppDebugRecordDataConnected(1_000)
    const ice = d.ice.last
    if (ice) {
      ice.localCandidateType = 'host'
      ice.remoteCandidateType = 'relay'
    }
    assertPpDebugHasNoIds(ppDebug())
    assert.equal(ppDebug().remember.dials, 2)
    assert.ok(!('lastTarget' in ppDebug().remember))
    assert.equal(gen, 1)
  })
})
