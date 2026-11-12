import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CoreCtx } from '../../core/bus'
import { MoverControl } from './Mover'
import { Remote } from './Remote'
import {
  moverBadgeText,
  moverCommandFrom,
  moverIntervalCommand,
  moverToggleCommand,
  moverView,
  readMoverState,
} from '../screen/mover'

function ctx(): CoreCtx {
  return {
    role: 'guest',
    link: { remoteName: 'Laptop', status: 'connected' } as CoreCtx['link'],
    send() {},
    toast() {},
    call: (() => { throw new Error('unused') }) as CoreCtx['call'],
    openPage() {},
  }
}

function markup(node: React.ReactElement) {
  return renderToStaticMarkup(node)
}

describe('mouse mover control', () => {
  it('follows the helper report and stays off until that report says on', () => {
    assert.equal(moverView(false, { on: true, interval: '1m' }), 'disconnected')
    assert.equal(moverView(true, { on: false, interval: null }), 'off')
    assert.equal(moverView(true, { on: true, interval: '5m' }), 'on')
    assert.equal(moverView(true, { on: true, interval: null }), 'off')
    assert.equal(moverBadgeText('30s'), 'Mouse mover on · every 30s')
    assert.equal(moverBadgeText('1m'), 'Mouse mover on · every 1m')
    assert.equal(moverBadgeText('5m'), 'Mouse mover on · every 5m')

    assert.deepEqual(readMoverState({ t: 'mover', on: true, interval: '30s' }), { on: true, interval: '30s' })
    assert.deepEqual(readMoverState({ t: 'mover', on: true, interval: '1m' }), { on: true, interval: '1m' })
    assert.deepEqual(readMoverState({ t: 'mover', on: true, interval: '5m' }), { on: true, interval: '5m' })
    assert.deepEqual(readMoverState({ t: 'mover', on: false, interval: '1m' }), { on: false, interval: null })
    assert.equal(readMoverState({ t: 'mover', on: true, interval: '10s' }), null)
    assert.equal(readMoverState({ t: 'mover', on: true, interval: '2m' }), null)
    assert.equal(readMoverState({ t: 'mover', on: true }), null)
    assert.equal(readMoverState({ t: 'mover', ask: true }), null)
    assert.equal(moverCommandFrom({ on: true, interval: '10s' }), null)
    assert.equal(moverCommandFrom({ ask: true, on: true, interval: '30s' }), null)
    assert.deepEqual(moverCommandFrom({ on: false }), { on: false })
    assert.deepEqual(moverToggleCommand({ on: false, interval: null }), { on: true, interval: '1m' })
    assert.deepEqual(moverToggleCommand({ on: true, interval: '5m' }), { on: false })
    assert.deepEqual(moverIntervalCommand('30s'), { on: true, interval: '30s' })

    const disconnected = markup(React.createElement(MoverControl, {
      connected: false,
      state: { on: true, interval: '1m' },
      onToggle() {},
      onInterval() {},
    }))
    assert.match(disconnected, /data-state="disconnected"/)
    assert.match(disconnected, /data-testid="mover-toggle"[^>]*disabled/)
    assert.match(disconnected, /aria-checked="false"/)
    assert.match(disconnected, /Connect laptop control first\./)
    assert.equal(disconnected.includes('data-testid="mover-badge"'), false)
    assert.equal(disconnected.includes('Mouse mover on'), false)
    for (const id of ['30s', '1m', '5m']) {
      assert.match(disconnected, new RegExp(`data-testid="mover-interval-${id}"[^>]*disabled`))
    }

    const off = markup(React.createElement(MoverControl, {
      connected: true,
      state: { on: false, interval: null },
      onToggle() {},
      onInterval() {},
    }))
    assert.match(off, /data-state="off"/)
    assert.match(off, /aria-checked="false"/)
    assert.equal(off.includes('data-testid="mover-toggle" disabled'), false)
    assert.match(off, /data-testid="mover-interval-30s"[^>]*disabled/)
    assert.equal(off.includes('mover-badge'), false)

    const on = markup(React.createElement(MoverControl, {
      connected: true,
      state: { on: true, interval: '1m' },
      onToggle() {},
      onInterval() {},
    }))
    assert.match(on, /data-state="on"/)
    assert.match(on, /aria-checked="true"/)
    assert.match(on, /data-testid="mover-badge"/)
    assert.match(on, /Mouse mover on · every 1m/)
    assert.match(on, /aria-pressed="true"[^>]*data-testid="mover-interval-1m"/)
    assert.match(on, /aria-pressed="false"[^>]*data-testid="mover-interval-30s"/)
    assert.equal(on.includes('mover-interval-1m" disabled'), false)
  })

  it('places Keep awake between the pointer and the keyboard on the phone', () => {
    const html = markup(React.createElement(Remote, { ctx: ctx() }))
    const pointer = html.indexOf('data-testid="pointer"')
    const toggle = html.indexOf('data-testid="mover-toggle"')
    const keyboard = html.indexOf('data-testid="kb-input"')
    assert.ok(pointer >= 0 && toggle > pointer && keyboard > toggle, html)
    assert.match(html, /Keep awake/)
    assert.match(html, /data-state="disconnected"/)
    assert.match(html, /Connect laptop control first\./)
    assert.equal(html.includes('Mouse mover on'), false)
    const src = readFileSync(join(process.cwd(), 'src/features/remote/Remote.tsx'), 'utf8')
    assert.match(src, /useMessage\('mover'/)
    assert.match(src, /readMoverState/)
    assert.equal(src.includes('setMover(true)'), false)
  })
})
