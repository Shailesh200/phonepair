import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CoreCtx } from '../../core/bus'
import { clearPadGesture, Remote } from './Remote'
import {
  REMOTE_MODE_KEY, getRemoteMode, isRemoteMode, readRemoteMode, restoreRemoteMode, setRemoteMode, subscribeRemoteMode, writeRemoteMode, type RemoteMode,
} from './mode'
import { createRemoteSend, remoteChannelsCreated, type RemotePayload } from './send'
import { remoteStyles } from './styles'

declare const __REMOTE_SRC__: string
declare const __INDEX_SRC__: string
declare const __SEND_SRC__: string
declare const __MODE_SRC__: string
declare const process: { cwd(): string }

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
declare module 'node:test' {
  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: () => Promise<void> | void): void
}

function sourceFile(name: string) {
  return readFileSync(join(process.cwd(), 'src/features/remote', name), 'utf8')
}

function injected(value: unknown, file: string) {
  return typeof value === 'string' && value.length > 0 ? value : sourceFile(file)
}

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

function count(hay: string, needle: string) {
  return hay.split(needle).length - 1
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear() { map.clear() },
    getItem(key: string) { return map.has(key) ? map.get(key)! : null },
    key(index: number) { return [...map.keys()][index] ?? null },
    removeItem(key: string) { map.delete(key) },
    setItem(key: string, value: string) { map.set(key, String(value)) },
  }
}

function installStorage() {
  const store = memoryStorage()
  ;(globalThis as { localStorage?: Storage }).localStorage = store
  restoreRemoteMode(store)
  return store
}

function ctx(sent: RemotePayload[] = []): CoreCtx {
  return {
    role: 'guest',
    link: { remoteName: 'Laptop', status: 'connected' } as CoreCtx['link'],
    send: ((msg: RemotePayload) => { sent.push(msg) }) as CoreCtx['send'],
    toast() {},
    call: (() => { throw new Error('unused') }) as CoreCtx['call'],
    openPage() {},
  }
}

function markup(className?: string) {
  return renderToStaticMarkup(React.createElement(Remote, { ctx: ctx(), className }))
}

function selectedTab(html: string) {
  const match = html.match(/aria-selected="true"[^>]*data-testid="(rtab-[^"]+)"|data-testid="(rtab-[^"]+)"[^>]*aria-selected="true"/)
  return match?.[1] || match?.[2] || ''
}

const TESTIDS = ['rtab-trackpad', 'rtab-clicker', 'rtab-pointer', 'trackpad', 'scroll-strip', 'lclick', 'rclick', 'prev', 'next', 'kb-toggle']

export async function runRemoteTests() {
  const remoteSrc = injected(typeof __REMOTE_SRC__ === 'string' ? __REMOTE_SRC__ : undefined, 'Remote.tsx')
  const indexSrc = injected(typeof __INDEX_SRC__ === 'string' ? __INDEX_SRC__ : undefined, 'index.tsx')
  const sendSrc = injected(typeof __SEND_SRC__ === 'string' ? __SEND_SRC__ : undefined, 'send.ts')
  const modeSrc = injected(typeof __MODE_SRC__ === 'string' ? __MODE_SRC__ : undefined, 'mode.ts')
  expect(isRemoteMode('trackpad') && isRemoteMode('clicker') && isRemoteMode('pointer'), 'three remote modes')
  expect(!isRemoteMode('keyboard') && !isRemoteMode(''), 'unknown mode is rejected')

  const denied = {
    getItem() { throw new Error('denied') },
    setItem() { throw new Error('denied') },
    removeItem() { throw new Error('denied') },
    clear() { throw new Error('denied') },
    key() { return null },
    length: 0,
  } as Storage
  expect(readRemoteMode(denied) === 'trackpad', 'unreadable storage falls back to trackpad')
  expect(setRemoteMode('pointer', denied) === 'pointer', 'a blocked write still switches the live mode')

  const store = installStorage()
  expect(readRemoteMode(store) === 'trackpad', 'empty storage restores trackpad')
  expect(getRemoteMode() === 'trackpad', 'live mode matches the restored value')

  writeRemoteMode('clicker', store)
  expect(store.getItem(REMOTE_MODE_KEY) === 'clicker', 'clicker is written to localStorage')
  expect(restoreRemoteMode(store) === 'clicker', 'restore reads clicker back')
  expect(getRemoteMode() === 'clicker', 'restored mode is the live mode')

  store.setItem(REMOTE_MODE_KEY, 'nope')
  expect(readRemoteMode(store) === 'trackpad', 'a bad saved value restores trackpad')
  expect(restoreRemoteMode(store) === 'trackpad', 'restore ignores a bad saved value')
  expect(store.getItem(REMOTE_MODE_KEY) === 'nope', 'restore does not rewrite a bad value on its own')

  let notices = 0
  const stop = subscribeRemoteMode(() => { notices += 1 })
  expect(setRemoteMode('pointer') === 'pointer', 'switch to pointer')
  expect(notices === 1, 'a mode switch notifies listeners once')
  expect(store.getItem(REMOTE_MODE_KEY) === 'pointer', 'pointer is persisted')
  setRemoteMode('pointer')
  expect(notices === 1, 'setting the current mode does not notify again')
  expect(setRemoteMode('slideshow' as RemoteMode) === 'pointer', 'an invalid switch is ignored')
  expect(store.getItem(REMOTE_MODE_KEY) === 'pointer', 'an invalid switch does not overwrite storage')
  stop()

  store.removeItem(REMOTE_MODE_KEY)
  restoreRemoteMode(store)
  let html = markup()
  expect(html.includes('data-mode="trackpad"'), 'default render is trackpad: ' + html)
  expect(html.includes('class="pg remote"'), 'plain page class comes from the styles module')
  expect(selectedTab(html) === 'rtab-trackpad', 'trackpad tab is selected: ' + selectedTab(html))
  expect(html.includes('Swipe to move · tap to click'), 'trackpad hint')
  expect(!html.includes('Swipe to move the pointer'), 'trackpad hint is not the pointer hint')
  expect(!html.includes('nav2 tall'), 'trackpad nav is not the tall clicker nav')
  expect(html.includes('>' + 'Trackpad' + '<') && html.includes('>Clicker<') && html.includes('>Pointer<'), 'mode switcher labels')
  for (const id of TESTIDS) expect(html.includes(`data-testid="${id}"`), 'trackpad render keeps ' + id)

  const channelsAtTrackpad = remoteChannelsCreated()
  writeRemoteMode('clicker', store)
  restoreRemoteMode(store)
  html = markup()
  expect(remoteChannelsCreated() === channelsAtTrackpad + 1, 'each Remote mount builds one shared send path')
  expect(html.includes('data-mode="clicker"'), 'restored clicker mode is shown')
  expect(selectedTab(html) === 'rtab-clicker', 'clicker tab is selected after restore')
  expect(html.includes(remoteStyles.clickerHelp.split(' ')[0]), 'clicker help is shown')
  expect(html.includes('slideshow open in this tab'), 'clicker keeps its explanation')
  expect(!html.includes('data-testid="trackpad"'), 'clicker hides the trackpad')
  expect(!html.includes('data-testid="lclick"') && !html.includes('data-testid="rclick"') && !html.includes('data-testid="scroll-strip"'), 'clicker hides trackpad controls')
  expect(html.includes('data-testid="prev"') && html.includes('data-testid="next"') && html.includes('data-testid="kb-toggle"'), 'clicker keeps nav and keyboard')
  expect(html.includes('class="two nav2 tall"'), 'clicker nav keeps the tall layout')
  for (const id of ['rtab-trackpad', 'rtab-clicker', 'rtab-pointer', 'prev', 'next', 'kb-toggle']) {
    expect(html.includes(`data-testid="${id}"`), 'clicker render keeps ' + id)
  }

  setRemoteMode('pointer')
  expect(store.getItem(REMOTE_MODE_KEY) === 'pointer', 'switching to pointer persists')
  const channelsBeforeSkin = remoteChannelsCreated()
  html = markup('skin')
  expect(remoteChannelsCreated() === channelsBeforeSkin + 1, 'pointer render still builds one send path')
  expect(store.getItem(REMOTE_MODE_KEY) === 'pointer', 'rendering does not drop the saved mode')
  expect(html.includes('data-mode="pointer"'), 'switched render shows pointer')
  expect(html.includes('class="pg remote skin"'), 'className is the styling hook')
  expect(selectedTab(html) === 'rtab-pointer', 'pointer tab is selected after switching')
  expect(html.includes('Swipe to move the pointer'), 'pointer keeps its hint')
  expect(html.includes('tap to click · two fingers to scroll'), 'pointer keeps tap and scroll copy')
  for (const id of TESTIDS) expect(html.includes(`data-testid="${id}"`), 'pointer render keeps ' + id)

  const saved = store.getItem(REMOTE_MODE_KEY)
  const reloaded = memoryStorage()
  reloaded.setItem(REMOTE_MODE_KEY, saved || '')
  ;(globalThis as { localStorage?: Storage }).localStorage = reloaded
  expect(restoreRemoteMode(reloaded) === 'pointer', 'a new page load restores pointer')
  const channelsBeforeReload = remoteChannelsCreated()
  html = markup()
  expect(remoteChannelsCreated() === channelsBeforeReload + 1, 'a restored mount still builds one send path')
  expect(html.includes('data-mode="pointer"') && selectedTab(html) === 'rtab-pointer', 'restored page opens on pointer')

  const sent: RemotePayload[] = []
  const channel = createRemoteSend((msg) => { sent.push(msg as RemotePayload) })
  channel.move(2, -3)
  channel.click('left')
  channel.scroll(0, 8)
  channel.nav('prev')
  channel.nav('next')
  channel.pointer(true)
  channel.click('right')
  channel.scroll(1, 0)
  channel.type('Hi')
  channel.key('Backspace')
  channel.key('Enter')
  channel.helper({ ask: true })
  channel.send({ t: 'remote:pointer', on: false })
  const kinds = sent.map((msg) => msg.t)
  expect(kinds.join(',') === [
    'remote:move', 'remote:click', 'remote:scroll', 'remote:nav', 'remote:nav',
    'remote:pointer', 'remote:click', 'remote:scroll', 'remote:type', 'remote:key', 'remote:key',
    'remote:helper', 'remote:pointer',
  ].join(','), 'trackpad, clicker, and pointer share one send callback: ' + kinds.join(','))
  expect(sent[0].t === 'remote:move' && sent[0].dx === 2 && sent[0].dy === -3, 'move payload')
  expect(sent[1].t === 'remote:click' && sent[1].btn === 'left', 'trackpad tap click')
  const prevNav = sent[3]
  const nextNav = sent[4]
  expect(prevNav.t === 'remote:nav' && prevNav.dir === 'prev', 'clicker prev payload')
  expect(nextNav.t === 'remote:nav' && nextNav.dir === 'next', 'clicker next payload')
  expect(sent[6].t === 'remote:click' && sent[6].btn === 'right', 'pointer right click')
  expect(sent[8].t === 'remote:type' && sent[8].text === 'Hi', 'keyboard type payload')
  expect(sent[11].t === 'remote:helper' && sent[11].ask === true, 'helper ask uses the same path')

  expect(count(remoteSrc, 'createRemoteSend(') === 1, 'Remote creates one send path')
  expect(count(remoteSrc, 'ctxRef.current.send') === 1, 'that path is the only connection send')
  expect(!remoteSrc.includes('ctx.send('), 'modes do not send on their own')
  for (const call of ['send.move(', 'send.click(', 'send.scroll(', 'send.nav(', 'send.type(', 'send.key(', 'send.pointer(', 'send.helper(']) {
    expect(remoteSrc.includes(call), 'shared path is used for ' + call)
  }
  const cancelled: number[] = []
  const pad = {
    pts: new Map<number, { x: number; y: number }>([[7, { x: 1, y: 2 }], [8, { x: 3, y: 4 }]]),
    accX: 11, accY: -4, scrX: 2, scrY: 9, raf: 42, down: 5, moved: 30, multi: true,
  }
  const strip = { raf: 99, acc: 6.5 }
  clearPadGesture(pad, (id) => { cancelled.push(id) }, strip)
  expect(pad.pts.size === 0, 'a mode change clears tracked pointers so the next touch is one finger')
  expect(pad.raf === 0 && pad.accX === 0 && pad.accY === 0 && pad.scrX === 0 && pad.scrY === 0 && pad.moved === 0 && pad.multi === false, 'a mode change cancels the frame and resets leftover deltas')
  expect(strip.raf === 0 && strip.acc === 0, 'a mode change resets the scroll strip')
  expect(cancelled.join(',') === '42,99', 'pending animation frames are cancelled: ' + cancelled.join(','))
  expect(remoteSrc.includes('clearPadGesture('), 'Remote clears the pad gesture')
  expect(remoteSrc.includes('onClick={() => { dropPad(); setRemoteMode(t) }}'), 'the mode switcher drops a stale pointer before changing mode')
  expect(remoteSrc.includes('setFingers([])'), 'leaving the pad hides leftover finger dots')

  expect(remoteSrc.includes('setRemoteMode(t)'), 'mode switcher writes the shared mode')
  expect(remoteSrc.includes('readRemoteMode') && remoteSrc.includes('subscribeRemoteMode'), 'Remote subscribes to the saved mode')
  expect(remoteSrc.includes('data-mode={mode}'), 'data-mode styling hook')
  expect(remoteSrc.includes('remotePageClass(className)'), 'className styling hook')
  expect(remoteSrc.includes('remoteStyles'), 'styles module is applied')
  expect(!remoteSrc.includes('useState<RemoteMode>') && !remoteSrc.includes("useState<Tab>('trackpad')"), 'mode is not local component state')
  expect(remoteSrc.includes('data-testid={`rtab-${t}`}'), 'mode tabs keep the rtab testids')
  for (const id of ['trackpad', 'scroll-strip', 'lclick', 'rclick', 'prev', 'next', 'kb-toggle', 'kb-input', 'full-laptop-badge']) {
    expect(remoteSrc.includes(`data-testid="${id}"`), 'existing testid stays in the component: ' + id)
  }

  expect(modeSrc.includes('localStorage'), 'mode persistence uses localStorage')
  expect(modeSrc.includes('phonepair.remote.mode'), 'mode storage key')
  expect(count(sendSrc, 'emit(') >= 8, 'every remote message is emitted on the one path')
  expect(sendSrc.includes('const emit = (msg: RemotePayload) => { send(msg) }'), 'emit is the single send')

  expect(indexSrc.includes('PhonePage: Remote'), 'the phone page is the merged Remote')
  expect(!indexSrc.includes('function PhonePage'), 'trackpad, clicker, and pointer are not a separate page')
  expect(!indexSrc.includes("useState<Tab>('trackpad')"), 'the old local tab state is gone')
}

describe('merged remote', () => {
  it('switches modes on one send path and drops a stale pointer', async () => {
    await runRemoteTests()
  })
})
