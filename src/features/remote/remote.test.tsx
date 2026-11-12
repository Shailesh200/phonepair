import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CoreCtx } from '../../core/bus'
import { clearPadGesture, Remote } from './Remote'
import { createRemoteSend, remoteChannelsCreated } from './send'

declare const __REMOTE_SRC__: string
declare const __INDEX_SRC__: string
declare const __SEND_SRC__: string

function repoFile(name: string) {
  const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ?? ''
  return readFileSync(join(cwd, 'src/features/remote', name), 'utf8')
}

function injected(value: unknown, file: string) {
  return typeof value === 'string' && value.length > 0 ? value : repoFile(file)
}

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function count(hay: string, needle: string) {
  return hay.split(needle).length - 1
}

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

const TESTIDS = ['rtab-trackpad', 'rtab-clicker', 'rtab-pointer', 'trackpad', 'scroll-strip', 'lclick', 'rclick', 'prev', 'next', 'kb-toggle', 'kb-input', 'pointer']

export async function runRemoteTests() {
  const remoteSrc = injected(typeof __REMOTE_SRC__ === 'string' ? __REMOTE_SRC__ : undefined, 'Remote.tsx')
  const indexSrc = injected(typeof __INDEX_SRC__ === 'string' ? __INDEX_SRC__ : undefined, 'index.tsx')
  const sendSrc = injected(typeof __SEND_SRC__ === 'string' ? __SEND_SRC__ : undefined, 'send.ts')

  const html = renderToStaticMarkup(React.createElement(Remote, { ctx: ctx(), className: 'skin' }))
  expect(html.includes('class="pg remote pp-remote skin"'), 'className styling hook')
  expect(html.includes('pp-remote-pad') && html.includes('pp-remote-clicker') && html.includes('pp-remote-laser'), 'spec class hooks')
  expect(!html.includes('role="tablist"'), 'one screen has no mode tabs')
  expect(!remoteSrc.includes('localStorage') && !remoteSrc.includes('phonepair.remote.mode'), 'layout does not persist a mode')
  const order = ['data-testid="trackpad"', 'data-testid="lclick"', 'data-testid="rclick"', 'class="pp-remote-clicker"', 'data-testid="prev"', 'data-testid="next"', 'class="pp-remote-laser"', 'data-testid="pointer"', 'data-testid="kb-toggle"', 'data-testid="kb-input"']
  let at = -1
  for (const bit of order) {
    const found = html.indexOf(bit)
    expect(found > at, 'screen order ' + bit + ' in ' + html)
    at = found
  }
  for (const id of TESTIDS) expect(html.includes(`data-testid="${id}"`), 'keeps ' + id)
  expect(html.includes('Swipe to move · tap to click'), 'trackpad hint')
  expect(html.includes('Pointer · hold to point'), 'hold-to-point laser')
  expect(html.includes('Type here, it appears on the laptop'), 'keyboard placeholder')

  const before = remoteChannelsCreated()
  renderToStaticMarkup(React.createElement(Remote, { ctx: ctx() }))
  expect(remoteChannelsCreated() === before + 1, 'one shared send path per screen')

  const sent: string[] = []
  const channel = createRemoteSend((msg) => { sent.push(JSON.stringify(msg)) })
  channel.move(4, 5)
  channel.click('left')
  channel.click('right')
  channel.scroll(0, 8)
  channel.nav('prev')
  channel.nav('next')
  channel.type('Hi')
  channel.key('Enter')
  channel.key('Backspace')
  channel.pointer(true)
  channel.pointer(false)
  channel.helper({ ask: true })
  const wire = [
    { t: 'remote:move', dx: 4, dy: 5 },
    { t: 'remote:click', btn: 'left' },
    { t: 'remote:click', btn: 'right' },
    { t: 'remote:scroll', dx: 0, dy: 8 },
    { t: 'remote:nav', dir: 'prev' },
    { t: 'remote:nav', dir: 'next' },
    { t: 'remote:type', text: 'Hi' },
    { t: 'remote:key', key: 'Enter' },
    { t: 'remote:key', key: 'Backspace' },
    { t: 'remote:pointer', on: true },
    { t: 'remote:pointer', on: false },
    { t: 'remote:helper', ask: true },
  ].map((msg) => JSON.stringify(msg))
  expect(sent.join('\n') === wire.join('\n'), 'wire payloads stay byte-identical: ' + sent.join(' | '))

  const cancelled: number[] = []
  const pad = {
    pts: new Map<number, { x: number; y: number }>([[7, { x: 1, y: 2 }], [8, { x: 3, y: 4 }]]),
    accX: 11, accY: -4, scrX: 2, scrY: 9, raf: 42, down: 5, moved: 30, multi: true,
  }
  const strip = { raf: 99, acc: 6.5 }
  clearPadGesture(pad, (id) => { cancelled.push(id) }, strip)
  expect(pad.pts.size === 0, 'pointer toggle clears tracked pointers')
  expect(pad.raf === 0 && pad.accX === 0 && pad.accY === 0 && pad.scrX === 0 && pad.scrY === 0 && pad.moved === 0 && pad.multi === false, 'pointer toggle resets the frame and accumulators')
  expect(strip.raf === 0 && strip.acc === 0, 'pointer toggle resets the scroll strip')
  expect(cancelled.join(',') === '42,99', 'pointer toggle cancels pending frames')
  expect(/const point = \(on: boolean\) => \{[\s\S]*clearPadGesture\(st\.current[\s\S]*send\.pointer\(on\)/.test(remoteSrc), 'the laser toggle clears the pad before it sends')

  expect(count(remoteSrc, 'createRemoteSend(') === 1, 'one send path is created')
  expect(count(remoteSrc, 'ctxRef.current.send') === 1, 'that path uses the shared connection')
  expect(!remoteSrc.includes('ctx.send('), 'modes do not send on their own')
  for (const call of ['send.move(', 'send.click(', 'send.scroll(', 'send.nav(', 'send.type(', 'send.key(', 'send.pointer(', 'send.helper(']) {
    expect(remoteSrc.includes(call) || sendSrc.includes(call.replace('send.', '').replace('(', '')), 'shared path covers ' + call)
  }
  expect(count(sendSrc, 'emit(') >= 8, 'every payload is emitted once')
  expect(indexSrc.includes('PhonePage: Remote'), 'the phone page is the merged Remote')
  expect(indexSrc.includes("laptopColumn: 'left'"), 'Full laptop sits on the left of the laptop layout')
  expect(!indexSrc.includes('function PhonePage'), 'there is no separate phone page')
}

describe('merged remote', () => {
  it('is one screen with the original wire payloads', async () => {
    await runRemoteTests()
  })
})
