import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { availability, helperCommands, readDisplaySurface, SCROLL_LIMIT } from './control.ts'
import { SC_REASON_HELPER, SC_REASON_SURFACE } from './sc.ts'

describe('screen control availability', () => {
  it('is on only for a monitor share with the helper connected', () => {
    assert.deepEqual(availability(true, 'monitor', true), { t: 'sc:avail', on: true })
    assert.deepEqual(availability(true, 'window', true), { t: 'sc:avail', on: false, reason: SC_REASON_SURFACE })
    assert.deepEqual(availability(true, 'browser', true), { t: 'sc:avail', on: false, reason: SC_REASON_SURFACE })
    assert.deepEqual(availability(false, 'monitor', true), { t: 'sc:avail', on: false, reason: SC_REASON_HELPER })
    assert.deepEqual(availability(true, undefined, true), { t: 'sc:avail', on: false, reason: SC_REASON_SURFACE })
    assert.deepEqual(availability(true, 'monitor', false), { t: 'sc:avail', on: false })
  })

  it('reads displaySurface and ignores anything else', () => {
    assert.equal(readDisplaySurface({ displaySurface: 'monitor' }), 'monitor')
    assert.equal(readDisplaySurface({ displaySurface: 'window' }), 'window')
    assert.equal(readDisplaySurface({ displaySurface: '' }), undefined)
    assert.equal(readDisplaySurface({}), undefined)
    assert.equal(readDisplaySurface(null), undefined)
  })
})

describe('screen control forwarding', () => {
  it('maps points, drags, clicks, and scroll onto helper commands', () => {
    assert.deepEqual(helperCommands({ t: 'sc', a: 'move', x: -0.2, y: 1.4 }), [{ t: 'abs', x: 0, y: 1 }])
    assert.deepEqual(helperCommands({ t: 'sc', a: 'down', x: 0.25, y: 0.5 }), [
      { t: 'abs', x: 0.25, y: 0.5 },
      { t: 'btn', btn: 'left', state: 'down' },
    ])
    assert.deepEqual(helperCommands({ t: 'sc', a: 'up', x: 0.25, y: 0.5 }), [
      { t: 'abs', x: 0.25, y: 0.5 },
      { t: 'btn', btn: 'left', state: 'up' },
    ])
    assert.deepEqual(helperCommands({ t: 'sc', a: 'click', x: 0.5, y: 0.5 }), [
      { t: 'abs', x: 0.5, y: 0.5 },
      { t: 'btn', btn: 'left', state: 'down' },
      { t: 'btn', btn: 'left', state: 'up' },
    ])
    assert.deepEqual(helperCommands({ t: 'sc', a: 'right', x: 0.1, y: 0.2 }), [
      { t: 'abs', x: 0.1, y: 0.2 },
      { t: 'btn', btn: 'right', state: 'down' },
      { t: 'btn', btn: 'right', state: 'up' },
    ])
    assert.deepEqual(helperCommands({ t: 'sc', a: 'dbl', x: 0.3, y: 0.4 }), [
      { t: 'abs', x: 0.3, y: 0.4 },
      { t: 'dbl' },
    ])
    assert.deepEqual(helperCommands({ t: 'sc', a: 'scroll', dx: 12, dy: -4 }), [{ t: 'scroll', dx: 12, dy: -4 }])
    assert.deepEqual(helperCommands({ t: 'sc', a: 'scroll', dx: 99999, dy: -99999 }), [
      { t: 'scroll', dx: SCROLL_LIMIT, dy: -SCROLL_LIMIT },
    ])
  })

  it('drops bad coordinates and anything that is not a pointer event', () => {
    for (const bad of [
      { t: 'sc', a: 'move', x: '0.2', y: 0.2 },
      { t: 'sc', a: 'click', x: Number.NaN, y: 0.2 },
      { t: 'sc', a: 'down', x: 0.2 },
      { t: 'sc', a: 'shell', x: 0.2, y: 0.2 },
      { t: 'sc', a: 'scroll', dx: Infinity, dy: 1 },
      { t: 'sc', a: 'scroll', dx: 0, dy: 0 },
      { t: 'file', path: '/etc/passwd' },
      { t: 'exec', cmd: 'id' },
      null,
      ['sc', 0, 0],
    ]) {
      assert.deepEqual(helperCommands(bad), [], JSON.stringify(bad))
    }
    assert.deepEqual(helperCommands({ t: 'sc', a: 'move', x: 0.2, y: 0.4, cmd: 'id' }), [{ t: 'abs', x: 0.2, y: 0.4 }])
  })
})
