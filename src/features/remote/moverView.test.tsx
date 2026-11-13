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
    assert.deepEqual(moverToggleCommand({ on: false, interval: null }), { on: true, interval: '3s' })
    assert.deepEqual(moverToggleCommand({ on: false, interval: '5m' }), { on: true, interval: '3s' })
    assert.deepEqual(moverToggleCommand({ on: true, interval: '5m' }), { on: false })

    const hands = { onStart() {}, onPause() {}, onStop() {}, onDuration() {}, onCustomMinutes() {} }
    const blank = { customMin: null, endsAt: null }
    const screen = markup(React.createElement(MoverControl, {
      ...hands,
      state: { on: true, interval: '3s', status: 'On (screen awake)', mode: 'wakeLock', autoStop: 'never', ...blank, endsAt: Date.now() + 15 * 60 * 1000 },
    }))
    assert.match(screen, /class="pp-mover-main"/)
    assert.match(screen, /data-state="on"/)
    assert.match(screen, /data-testid="mover-pause"/)
    assert.match(screen, /data-testid="mover-stop"/)
    assert.equal(screen.includes('mover-start'), false)
    assert.match(screen, /data-testid="mover-clock"/)
    assert.match(screen, /data-testid="mover-status"/)
    assert.match(screen, /On \(screen awake\)/)
    assert.equal(screen.includes('On (real mouse)'), false)
    assert.equal(screen.includes('Connect laptop control first'), false)
    assert.equal(screen.includes('data-mode'), false)
    assert.equal(screen.includes('mover-debug-mode'), false)
    assert.equal(screen.includes('mover-pip'), false)
    assert.match(screen, /Until you stop it/)
    assert.match(screen, /data-testid="mover-timing"/)
    assert.equal(screen.includes('Interval applies to laptop nudges'), false)
    assert.match(screen, /aria-pressed="true"[^>]*data-testid="mover-duration-never"/)
    for (const preset of ['15m', '30m', '1h', 'custom', 'never']) {
      assert.equal(new RegExp(`data-testid="mover-duration-${preset}"[^>]*disabled`).test(screen), false)
    }
    assert.equal(screen.includes('mover-interval-'), false)

    const off = markup(React.createElement(MoverControl, {
      ...hands,
      state: { on: false, interval: null, status: null, mode: 'none', autoStop: 'never', ...blank },
    }))
    assert.match(off, /data-state="off"/)
    assert.match(off, /data-testid="mover-start"/)
    assert.equal(off.includes('mover-pause'), false)
    assert.equal(off.includes('mover-interval-'), false)
    assert.equal(off.includes('mover-timing'), false)
    assert.match(off, /aria-pressed="true"[^>]*data-testid="mover-duration-never"/)
    for (const preset of ['15m', '30m', '1h', 'custom', 'never']) {
      assert.equal(new RegExp(`data-testid="mover-duration-${preset}"[^>]*disabled`).test(off), false)
    }
    assert.equal(off.includes('mover-badge'), false)
    assert.equal(off.includes('data-mode'), false)
    assert.equal(off.includes('mover-debug-mode'), false)

    const on = markup(React.createElement(MoverControl, {
      ...hands,
      state: { on: true, interval: '3s', status: 'On (real mouse)', mode: 'helper', autoStop: '1h', ...blank, endsAt: Date.now() + 60 * 60 * 1000 },
    }))
    assert.match(on, /data-state="on"/)
    assert.match(on, /data-testid="mover-pause"/)
    assert.match(on, /data-testid="mover-badge"/)
    assert.match(on, /data-testid="mover-status"/)
    assert.match(on, /On \(real mouse\)/)
    assert.equal(on.includes('Interval applies to laptop nudges'), false)
    assert.match(on, /data-testid="mover-timing"/)
    assert.match(on, /Ends /)
    assert.match(on, /aria-pressed="true"[^>]*data-testid="mover-duration-1h"/)
    for (const preset of ['15m', '30m', '1h', 'custom', 'never']) {
      assert.equal(new RegExp(`data-testid="mover-duration-${preset}"[^>]*disabled`).test(on), false)
    }

    const paused = markup(React.createElement(MoverControl, {
      ...hands,
      showPip: true,
      state: { on: true, interval: '3s', status: 'Paused, tab hidden', mode: 'video', autoStop: 'custom', customMin: 90, endsAt: Date.now() + 90 * 60 * 1000 },
    }))
    assert.match(paused, /data-state="paused"/)
    assert.match(paused, /Paused, tab hidden/)
    assert.match(paused, /data-testid="mover-pip"/)

    const quit = markup(React.createElement(MoverControl, {
      ...hands,
      state: { on: false, interval: '1m', status: 'Helper not running', mode: 'none', autoStop: 'never', ...blank },
    }))
    assert.match(quit, /data-state="unsupported"/)
    assert.match(quit, /data-testid="mover-start"/)
    assert.match(quit, /data-testid="mover-status"[^>]*>Helper not running</)
    assert.match(quit, /class="pp-mover-badge"/)
    assert.match(quit, /aria-pressed="true"[^>]*data-testid="mover-duration-never"/)
    for (const preset of ['15m', '30m', '1h', 'custom', 'never']) {
      assert.equal(new RegExp(`data-testid="mover-duration-${preset}"[^>]*disabled`).test(quit), false)
    }

    const unsupported = markup(React.createElement(MoverControl, {
      ...hands,
      state: { on: true, interval: '3s', status: 'Not supported', mode: 'none', autoStop: '15m', ...blank },
    }))
    assert.match(unsupported, /data-state="unsupported"/)
    assert.match(unsupported, /Not supported/)
    assert.match(unsupported, /data-testid="mover-duration-15m"/)
    assert.match(unsupported, /data-testid="mover-duration-30m"/)

    const qa = markup(React.createElement(MoverControl, {
      ...hands,
      qa: true,
      state: { on: false, interval: null, status: null, mode: 'wakeLock', autoStop: 'never', ...blank },
    }))
    assert.match(qa, /data-mode="wakeLock"/)
    assert.match(qa, /data-testid="mover-debug-mode"[^>]*>wakeLock</)
    const hidden = markup(React.createElement(MoverControl, {
      ...hands,
      qa: false,
      state: { on: false, interval: null, status: null, mode: 'video', autoStop: 'never', ...blank },
    }))
    assert.equal(hidden.includes('data-mode'), false)
    assert.equal(hidden.includes('mover-debug-mode'), false)
  })

  it('keeps Keep awake off the phone remote', () => {
    const html = markup(React.createElement(Remote, { ctx: ctx() }))
    const pointer = html.indexOf('data-testid="pointer"')
    const keyboard = html.indexOf('data-testid="kb-toggle"')
    assert.ok(pointer >= 0 && keyboard > pointer, html)
    assert.equal(html.includes('data-testid="mover-start"'), false)
    assert.equal(html.includes('Keep awake'), false)
    const card = readFileSync(join(process.cwd(), 'src/features/remote/index.tsx'), 'utf8')
    assert.match(card, /data-testid="keep-awake-card"/)
    const src = readFileSync(join(process.cwd(), 'src/features/remote/Remote.tsx'), 'utf8')
    assert.equal(src.includes('MoverControl'), false)
    const moverSrc = readFileSync(join(process.cwd(), 'src/features/remote/Mover.tsx'), 'utf8')
    assert.match(moverSrc, /onBlur=\{commitDraft\}/)
    assert.equal(/onChange=\{[^}]*onCustomMinutes/.test(moverSrc), false)
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
    assert.match(remote, /createKeepAwakeLinkWatch/)
    assert.match(remote, /moverStopsOn\('disconnect'\)\) stopMouseMover\(\)/)
    assert.match(remote, /ctx\.send\(relayReport\(awake\.view\(\)\)\)/)
    assert.match(remote, /onMessage\('bye', \(\) => \{ linkWatch\.userStop\(\) \}\)/)
    assert.equal(remote.includes('!ctx.link.connected && moverStopsOn'), false)
  })
})
