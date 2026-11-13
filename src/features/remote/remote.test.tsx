import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CoreCtx } from '../../core/bus'
import { Laptop } from '../../Laptop'
import '../../features'
import { clearPadGesture, Remote } from './Remote'
import { createRemoteSend, navKey, pointerOffBeforeDestroy, remoteChannelsCreated, showPointerLaser } from './send'

declare const __REMOTE_SRC__: string
declare const __INDEX_SRC__: string
declare const __SEND_SRC__: string

function repoCwd() {
  return (globalThis as { process?: { cwd?: () => string } }).process?.cwd?.() ?? ''
}

function repoFile(name: string) {
  return readFileSync(join(repoCwd(), 'src/features/remote', name), 'utf8')
}

function repoFileRoot(rel: string) {
  return readFileSync(join(repoCwd(), rel), 'utf8')
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

function pairedLaptop(): CoreCtx {
  const link = {
    role: 'host',
    status: 'connected',
    hadGuest: true,
    remoteName: 'Phone',
    code: 'ABCDEF',
    error: '',
    subscribe: () => () => {},
    disconnect() {},
    send() {},
  } as unknown as CoreCtx['link']
  return {
    role: 'host',
    link,
    send() {},
    toast() {},
    call: (() => { throw new Error('unused') }) as CoreCtx['call'],
    openPage() {},
  }
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

const TESTIDS = ['trackpad', 'scroll-strip', 'lclick', 'rclick', 'prev', 'next', 'kb-toggle', 'pointer']

export async function runRemoteTests() {
  const remoteSrc = injected(typeof __REMOTE_SRC__ === 'string' ? __REMOTE_SRC__ : undefined, 'Remote.tsx')
  const indexSrc = injected(typeof __INDEX_SRC__ === 'string' ? __INDEX_SRC__ : undefined, 'index.tsx')
  const sendSrc = injected(typeof __SEND_SRC__ === 'string' ? __SEND_SRC__ : undefined, 'send.ts')

  const html = renderToStaticMarkup(React.createElement(Remote, { ctx: ctx(), className: 'skin' }))
  expect(html.includes('class="pg remote pp-remote skin"'), 'className styling hook')
  expect(html.includes('pp-remote-pad') && html.includes('pp-remote-clicker') && html.includes('pp-remote-laser'), 'spec class hooks')
  expect(!html.includes('role="tablist"'), 'one screen has no mode tabs')
  expect(!remoteSrc.includes('localStorage') && !remoteSrc.includes('phonepair.remote.mode'), 'layout does not persist a mode')
  const order = ['data-testid="trackpad"', 'data-testid="lclick"', 'data-testid="rclick"', 'class="pp-remote-clicker"', 'data-testid="prev"', 'data-testid="next"', 'class="pp-remote-laser"', 'data-testid="pointer"', 'data-testid="kb-toggle"']
  let at = -1
  for (const bit of order) {
    const found = html.indexOf(bit)
    expect(found > at, 'screen order ' + bit + ' in ' + html)
    at = found
  }
  for (const id of TESTIDS) expect(html.includes(`data-testid="${id}"`), 'keeps ' + id)
  expect(html.includes('Swipe to move · tap to click'), 'trackpad hint')
  expect(html.includes('Pointer · hold to point'), 'hold-to-point laser')
  expect(!html.includes('data-testid="kb-input"'), 'keyboard stays closed')
  expect(remoteSrc.includes('const [kb, setKb] = useState(false)'), 'keyboard hidden until opened')
  expect(!remoteSrc.includes('autoFocus'), 'type field does not take focus')
  expect(remoteSrc.includes('Type here, it appears on the laptop'), 'keyboard placeholder')

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
  expect(/const point = \(on: boolean\) => \{[\s\S]*releasePad\(\)[\s\S]*send\.pointer\(on\)/.test(remoteSrc), 'the laser toggle clears the pad before it sends')
  expect(remoteSrc.includes('onBlur={() => point(false)}'), 'blur releases the laser')
  expect(remoteSrc.includes('onLostPointerCapture={() => point(false)}'), 'lost pointer capture releases the laser')
  expect(/const releasePad = \(\) => \{[\s\S]*clearPadGesture\(st\.current/.test(remoteSrc), 'releasePad clears through clearPadGesture')
  expect(/useEffect\(\(\) => \(\) => \{[\s\S]*releasePad\(\)[\s\S]*send\.pointer\(false\)/.test(remoteSrc), 'unmount clears the pad through the same path as the laser')
  expect(/const leavePage = \(\) => \{[\s\S]*point\(false\)[\s\S]*releasePad\(\)[\s\S]*lclick[\s\S]*rclick/.test(remoteSrc), 'leaving the page turns the laser off, releases the pad, and clears held clicks')
  expect(remoteSrc.includes("document.visibilityState === 'hidden'"), 'a hidden page releases the laser')
  expect(remoteSrc.includes("document.addEventListener('visibilitychange'") && remoteSrc.includes("document.removeEventListener('visibilitychange'"), 'the visibility listener is removed on unmount')
  expect(remoteSrc.includes("window.addEventListener('pagehide'") && remoteSrc.includes("window.removeEventListener('pagehide'"), 'the pagehide listener is removed on unmount')
  expect(remoteSrc.includes("document.addEventListener('freeze', leavePage)") && remoteSrc.includes("document.removeEventListener('freeze', leavePage)"), 'freeze uses leavePage and is removed on unmount')
  const torn: string[] = []
  pointerOffBeforeDestroy((m) => { torn.push(JSON.stringify(m)) }, () => { torn.push('destroy') })
  expect(torn.join('|') === '{"t":"remote:pointer","on":false}|destroy', 'pointer off is sent before the link is destroyed')
  const appSrc = repoFileRoot('src/App.tsx')
  expect(appSrc.includes('pointerOffBeforeDestroy((m) => l.send(m), () => l.destroy())'), 'page teardown sends pointer off before destroy')
  expect(showPointerLaser('connected') === true, 'laser can show while the phone is connected')
  expect(!showPointerLaser('reconnecting') && !showPointerLaser('closed') && !showPointerLaser('waiting') && !showPointerLaser(''), 'laser hides when the phone link drops or closes')
  expect(indexSrc.includes('showPointerLaser(ctx.link.status)') && indexSrc.includes('ctx.link.subscribe(syncLaser)') && indexSrc.includes('suppressOverlay()'), 'the laptop hides the laser when the phone link drops')
  const laptopSrc = repoFileRoot('src/Laptop.tsx')
  const cssSrc = repoFileRoot('src/styles.css')
  const gridAt = laptopSrc.indexOf('className="grid"')
  const grid = laptopSrc.slice(gridAt)
  expect(grid.indexOf('dash-remote') >= 0 && grid.indexOf('dash-remote') < grid.indexOf('data-testid="send-files"'), 'remote column comes before the send-files card in the grid')
  const wide = renderToStaticMarkup(React.createElement(Laptop, { ctx: pairedLaptop() }))
  const remoteAt = wide.indexOf('data-testid="remote-panel"')
  const filesAt = wide.indexOf('data-testid="send-files"')
  expect(remoteAt >= 0 && filesAt > remoteAt, 'rendered remote-panel comes before send-files')
  const remoteCol = wide.lastIndexOf('<div class="col dash-remote">', remoteAt)
  expect(remoteCol >= 0 && remoteCol < remoteAt, 'remote-panel renders inside the dash-remote column')
  const wideRule = cssSrc.split('@media (max-width:960px)')[0]
  expect(/\.dash-remote\s*\{[^}]*grid-column:\s*1/.test(wideRule) && /\.dash-remote\s*\{[^}]*grid-row:\s*1\s*\/\s*span\s*2/.test(wideRule), 'wide layout places Remote in column 1 spanning both rows')
  expect(/\.dash-files\s*\{[^}]*align-self:\s*start/.test(wideRule) && /\.dash-side\s*\{[^}]*align-self:\s*start/.test(wideRule) && /\.dash \.grid\s*\{[^}]*align-content:\s*start/.test(wideRule), 'column 2 stacks without a forced gap')
  expect(cssSrc.includes('.dash-remote { grid-column: 1') && cssSrc.includes('.dash-files { grid-column: 2'), 'two-column layout puts Remote on the left and Send files on the right')
  expect(/max-width:\s*960px[\s\S]*\.dash-files\{order:1/.test(cssSrc) && /max-width:\s*960px[\s\S]*\.dash-remote\{order:2/.test(cssSrc), 'stacked layout keeps Send files before Remote')

  expect(count(remoteSrc, 'createRemoteSend(') === 1, 'one send path is created')
  expect(count(remoteSrc, 'ctxRef.current.send') === 1, 'that path uses the shared connection')
  expect(!remoteSrc.includes('ctx.send('), 'modes do not send on their own')
  for (const call of ['send.move(', 'send.click(', 'send.scroll(', 'send.nav(', 'send.type(', 'send.key(', 'send.pointer(', 'send.helper(']) {
    expect(remoteSrc.includes(call) || sendSrc.includes(call.replace('send.', '').replace('(', '')), 'shared path covers ' + call)
  }
  expect(count(sendSrc, 'emit(') >= 8, 'every payload is emitted once')
  expect(navKey('next') === 'ArrowRight' && navKey('prev') === 'ArrowLeft', 'one Prev/Next press is one arrow')
  const navFn = indexSrc.slice(indexSrc.indexOf('function nav('), indexSrc.indexOf('function LaptopOverlay'))
  const navMsg = indexSrc.slice(indexSrc.indexOf("onMessage('remote:nav'"), indexSrc.indexOf("onMessage('remote:type'"))
  expect(navFn.includes('pageKey(navKey(dir))') && !navFn.includes('PageUp') && !navFn.includes('PageDown'), 'in-tab nav sends one key')
  expect(count(navMsg, 'sendHelper(') === 1 && !navMsg.includes('PageUp') && !navMsg.includes('PageDown'), 'one nav press sends the helper exactly one key')
  expect(indexSrc.includes('PhonePage: Remote'), 'the phone page is the merged Remote')
  expect(indexSrc.includes("laptopColumn: 'left'"), 'Full laptop sits on the left of the laptop layout')
  expect(!indexSrc.includes('function PhonePage'), 'there is no separate phone page')
}

describe('merged remote', () => {
  it('is one screen with the original wire payloads', async () => {
    await runRemoteTests()
  })
})
