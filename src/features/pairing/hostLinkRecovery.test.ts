import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  hostShowsPairedView,
  hostStatusAfterDataConnLost,
  hostStatusWhenSignalOpens,
  laptopStatusLabel,
  nextHostStatusAfterRecoveryGrace,
} from './hostSignalReconnect.ts'

describe('host link recovery view', () => {
  it('stays on the paired screen with Reconnecting… through a drop and the 15s grace', () => {
    assert.equal(hostStatusWhenSignalOpens(true, false), 'reconnecting')
    assert.equal(hostStatusWhenSignalOpens(true, true), 'connected')
    assert.equal(hostStatusWhenSignalOpens(false, false), 'waiting')
    assert.equal(hostShowsPairedView('reconnecting', true), true)
    assert.equal(hostShowsPairedView('connecting', true), true)
    assert.equal(hostShowsPairedView('waiting', true), false)
    assert.equal(hostShowsPairedView('reconnecting', false), false)
    assert.equal(nextHostStatusAfterRecoveryGrace('reconnecting', false), 'reconnecting')
    assert.equal(laptopStatusLabel('reconnecting', true), 'Reconnecting…')
    assert.equal(laptopStatusLabel('connecting', true), 'Reconnecting…')
    const link = readFileSync(join(process.cwd(), 'src/core/link.ts'), 'utf8')
    assert.match(link, /hostStatusWhenSignalOpens\(this\.everConnected, !!this\.conn\?\.open\)/)
    const grace = link.slice(link.indexOf('this.hostGrace = window.setTimeout'), link.indexOf('}, 15000)'))
    assert.match(grace, /nextHostStatusAfterRecoveryGrace\(this\.status, !!this\.conn\?\.open\)/)
    assert.equal(grace.includes("status: 'waiting'"), false)
  })

  it('keeps a phone bye on waiting instead of flipping back to reconnecting', () => {
    assert.equal(hostStatusAfterDataConnLost(true, true), 'waiting')
    assert.equal(hostStatusAfterDataConnLost(true, false), 'reconnecting')
    assert.equal(hostStatusAfterDataConnLost(false, false), 'waiting')
    const link = readFileSync(join(process.cwd(), 'src/core/link.ts'), 'utf8')
    assert.match(link, /if \(this\.hostEndedPairing\)/)
    assert.match(link, /this\.hostEndedPairing = true/)
    const bye = link.slice(link.indexOf("if (m.t === 'bye')"), link.indexOf("if (m.t === 'remember:forget')"))
    assert.match(bye, /status: this\.role === 'host' \? 'waiting' : 'closed'/)
  })
})
