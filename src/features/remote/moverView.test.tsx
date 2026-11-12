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
  moverStopsOn,
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

    const hands = { onToggle() {}, onInterval() {}, onAutoStop() {} }
    const screen = markup(React.createElement(MoverControl, {
      ...hands,
      state: { on: true, interval: '1m', status: 'On (screen awake)', mode: 'wakeLock', autoStop: 'never' },
    }))
    assert.match(screen, /class="pp-mover-main"/)
    assert.match(screen, /data-state="on"/)
    assert.match(screen, /aria-checked="true"/)
    assert.equal(/data-testid="mover-toggle"[^>]*disabled/.test(screen), false)
    assert.match(screen, /data-testid="mover-status"/)
    assert.match(screen, /On \(screen awake\)/)
    assert.equal(screen.includes('On (real mouse)'), false)
    assert.equal(screen.includes('Connect laptop control first'), false)
    assert.equal(screen.includes('data-mode'), false)
    assert.equal(screen.includes('mover-debug-mode'), false)
    assert.equal(screen.includes('mover-pip'), false)
    assert.match(screen, /Interval applies to laptop nudges\./)
    assert.match(screen, /aria-pressed="true"[^>]*data-testid="mover-autostop-never"/)
    for (const id of ['30s', '1m', '5m']) {
      assert.match(screen, new RegExp(`data-testid="mover-interval-${id}"[^>]*disabled`))
    }

    const off = markup(React.createElement(MoverControl, {
      ...hands,
      state: { on: false, interval: null, status: null, mode: 'none', autoStop: 'never' },
    }))
    assert.match(off, /data-state="off"/)
    assert.match(off, /aria-checked="false"/)
    assert.equal(/data-testid="mover-toggle"[^>]*disabled/.test(off), false)
    assert.match(off, /data-testid="mover-interval-30s"[^>]*disabled/)
    assert.equal(off.includes('mover-badge'), false)
    assert.equal(off.includes('data-mode'), false)
    assert.equal(off.includes('mover-debug-mode'), false)

    const on = markup(React.createElement(MoverControl, {
      ...hands,
      state: { on: true, interval: '1m', status: 'On (real mouse)', mode: 'helper', autoStop: '1h' },
    }))
    assert.match(on, /data-state="on"/)
    assert.match(on, /aria-checked="true"/)
    assert.match(on, /data-testid="mover-badge"/)
    assert.match(on, /data-testid="mover-status"/)
    assert.match(on, /On \(real mouse\)/)
    assert.equal(on.includes('Interval applies to laptop nudges'), false)
    assert.match(on, /aria-pressed="true"[^>]*data-testid="mover-interval-1m"/)
    assert.match(on, /aria-pressed="false"[^>]*data-testid="mover-interval-30s"/)
    assert.equal(on.includes('mover-interval-1m" disabled'), false)
    assert.match(on, /aria-pressed="true"[^>]*data-testid="mover-autostop-1h"/)

    const paused = markup(React.createElement(MoverControl, {
      ...hands,
      showPip: true,
      state: { on: true, interval: '5m', status: 'Paused, tab hidden', mode: 'video', autoStop: '2h' },
    }))
    assert.match(paused, /data-state="paused"/)
    assert.match(paused, /Paused, tab hidden/)
    assert.match(paused, /data-testid="mover-pip"/)

    const unsupported = markup(React.createElement(MoverControl, {
      ...hands,
      state: { on: true, interval: '1m', status: 'Not supported', mode: 'none', autoStop: '15m' },
    }))
    assert.match(unsupported, /data-state="unsupported"/)
    assert.match(unsupported, /Not supported/)
    assert.match(unsupported, /data-testid="mover-autostop-15m"/)
    assert.match(unsupported, /data-testid="mover-autostop-30m"/)

    const qa = markup(React.createElement(MoverControl, {
      ...hands,
      qa: true,
      state: { on: false, interval: null, status: null, mode: 'wakeLock', autoStop: 'never' },
    }))
    assert.match(qa, /data-mode="wakeLock"/)
    assert.match(qa, /data-testid="mover-debug-mode"[^>]*>wakeLock</)
    const hidden = markup(React.createElement(MoverControl, {
      ...hands,
      qa: false,
      state: { on: false, interval: null, status: null, mode: 'video', autoStop: 'never' },
    }))
    assert.equal(hidden.includes('data-mode'), false)
    assert.equal(hidden.includes('mover-debug-mode'), false)
  })

  it('places Keep awake between the pointer and the keyboard on the phone', () => {
    const html = markup(React.createElement(Remote, { ctx: ctx() }))
    const pointer = html.indexOf('data-testid="pointer"')
    const toggle = html.indexOf('data-testid="mover-toggle"')
    const keyboard = html.indexOf('data-testid="kb-input"')
    assert.ok(pointer >= 0 && toggle > pointer && keyboard > toggle, html)
    assert.match(html, /Keep awake/)
    assert.match(html, /class="pp-mover-main"/)
    assert.match(html, /data-state="off"/)
    assert.equal(/data-testid="mover-toggle"[^>]*disabled/.test(html), false)
    assert.equal(html.includes('Connect laptop control first'), false)
    assert.equal(html.includes('data-mode'), false)
    assert.equal(html.includes('mover-debug-mode'), false)
    assert.match(html, /Interval applies to laptop nudges\./)
    assert.match(html, /data-testid="mover-autostop-never"/)
    assert.equal(html.includes('Mouse mover on'), false)
    assert.equal(html.includes('On (real mouse)'), false)
    const src = readFileSync(join(process.cwd(), 'src/features/remote/Remote.tsx'), 'utf8')
    assert.match(src, /useMessage\('mover'/)
    assert.match(src, /readMoverState/)
    assert.equal(src.includes('setMover(true)'), false)
  })

  it('leaves keep-awake on when screen control ends, and stops it on unpair', () => {
    assert.equal(moverStopsOn('sc:stop'), false)
    assert.equal(moverStopsOn('endControl'), false)
    assert.equal(moverStopsOn('unpair'), true)
    assert.equal(moverStopsOn('disconnect'), true)
    assert.equal(moverStopsOn('socket-close'), true)
    assert.equal(moverStopsOn('toggle'), true)
    assert.equal(moverStopsOn('quit'), true)
    const remote = readFileSync(join(process.cwd(), 'src/features/remote/index.tsx'), 'utf8')
    const screen = readFileSync(join(process.cwd(), 'src/features/screen/index.tsx'), 'utf8')
    assert.equal(screen.includes('stopMouseMover'), false)
    assert.equal(/onMessage\('sc:stop'[\s\S]{0,120}stopMouseMover/.test(remote), false)
    assert.match(remote, /keepAwakeLinkEffect\(ctx\.link\.status\)/)
    assert.match(remote, /effect === 'stop' && moverStopsOn\('disconnect'\)\) stopMouseMover\(\)/)
    assert.match(remote, /effect === 'resync'\) ctx\.send\(relayReport\(awake\.view\(\)\)\)/)
    assert.equal(remote.includes('!ctx.link.connected && moverStopsOn'), false)
  })
})
