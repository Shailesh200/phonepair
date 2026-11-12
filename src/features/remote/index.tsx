// Phone as a remote for this tab. Messages: remote:move, remote:click, remote:scroll,
// remote:nav, remote:type, remote:key, remote:pointer.
import React, { useEffect, useRef, useState } from 'react'
import { CoreCtx, createStore, onMessage, registerFeature } from '../../core/bus'
import { Remote } from './Remote'
import { MoverControl } from './Mover'
import { Icon } from '../../core/icons'
import { CopyBtn } from '../../core/ui'
import { ConnectGuide } from './ConnectGuide'
import { helperProbeTimeout, settleHelperProbe, type HelperProbeSocket } from './helperProbe'
import {
  moverIntervalCommand,
  moverStopsOn,
  moverToggleCommand,
  readMoverState,
} from '../screen/mover'
import { KEEP_AWAKE_IDLE, browserSearch, keepAwakeLinkEffect, pictureInPictureEnabled, qaHooksEnabled, readRelayCommand, relayReport, type KeepAwakeViewState } from './keepAwake'
import { createBrowserKeepAwake } from './keepAwakeRun'
import { navKey, showPointerLaser } from './send'
import type { HelperAttempt } from './connectGuide.ts'
import './remote.css'

const MOVE_GAIN = 1.6
const SCROLL_GAIN = 2
const NON_TEXT = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'image', 'hidden'])

type Btn = 'left' | 'right'

const HELPER_PORTS = [47811, 47812, 47813, 47814]
type HelperStatus = 'off' | 'connecting' | 'connected'
type HelperResult = 'connected' | 'rejected' | 'down' | 'cancelled'

const pos = { x: 0, y: 0, visible: false, laser: false }
let cursorEl: HTMLDivElement | null = null
let hideTimer: number | undefined
const helper = {
  status: 'off' as HelperStatus,
  ws: null as WebSocket | null,
  listeners: new Set<() => void>(),
}
const moverReported = createStore<KeepAwakeViewState>(KEEP_AWAKE_IDLE)
let moverRelay: { send: (msg: ReturnType<typeof relayReport>) => void; connected: () => boolean } | null = null
let awake!: ReturnType<typeof createBrowserKeepAwake>

function readHelperMover(data: unknown) {
  let parsed: unknown
  try { parsed = JSON.parse(String(data)) } catch { return }
  const state = readMoverState(parsed)
  if (state) awake.noteHelperReport(state)
}

export function stopMouseMover() {
  awake.stop()
}

export function MoverHeaderBadge() {
  const state = moverReported.use()
  if (!state.status) return null
  return <span className="pp-mover-badge" data-testid="mover-badge">{state.status}</span>
}
let helperJob = 0
let helperConnects = 0

function emitHelper() {
  helper.listeners.forEach((fn) => fn())
}

function useHelper() {
  const [, bump] = useState(0)
  useEffect(() => {
    const fn = () => bump((n) => n + 1)
    helper.listeners.add(fn)
    return () => { helper.listeners.delete(fn) }
  }, [])
  return helper
}

function helperReady() {
  return helper.status === 'connected' && !!helper.ws && helper.ws.readyState === WebSocket.OPEN
}

function sendHelper(msg: object) {
  if (!helperReady() || !helper.ws) return false
  helper.ws.send(JSON.stringify(msg))
  return true
}

awake = createBrowserKeepAwake({
  helperConnected: () => helperReady(),
  sendHelper: (msg) => { sendHelper(msg) },
  publish: (state) => {
    moverReported.set(state)
    if (moverRelay?.connected()) moverRelay.send(relayReport(state))
  },
})

export function helperConnected() {
  return helperReady()
}

export function forwardHelper(msg: object) {
  return sendHelper(msg)
}

export function subscribeHelper(listener: () => void) {
  helper.listeners.add(listener)
  return () => { helper.listeners.delete(listener) }
}

function watchHelper(ws: WebSocket) {
  ws.onmessage = (ev) => { readHelperMover(ev.data) }
  ws.onclose = () => {
    if (helper.ws !== ws) return
    helper.ws = null
    helper.status = 'off'
    awake.onHelperDisconnected()
    emitHelper()
  }
}

function closeHelperSocket() {
  const ws = helper.ws
  helper.ws = null
  if (!ws) return
  ws.onopen = null
  ws.onmessage = null
  ws.onerror = null
  ws.onclose = null
  try { ws.close() } catch { /* already closed */ }
}

function suppressOverlay() {
  pos.laser = false
  pos.visible = false
  paint()
}

function printableRun(text: string) {
  return [...text].filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0
    return cp >= 32 && cp !== 127
  }).join('')
}

function tryHelperPort(port: number, code: string, mine: number, attempt: number, portIndex: number): Promise<'connected' | 'rejected' | 'down'> {
  let ws: WebSocket
  try { ws = new WebSocket(`ws://127.0.0.1:${port}`) } catch { return Promise.resolve('down') }
  return settleHelperProbe({
    code,
    mine,
    currentJob: () => helperJob,
    timeoutMs: helperProbeTimeout(attempt, portIndex),
    socket: ws as unknown as HelperProbeSocket,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => { window.clearTimeout(id) },
    onPaired: () => {
      helper.ws = ws
      watchHelper(ws)
    },
  })
}

async function connectHelper(code: string): Promise<HelperResult> {
  const attempt = helperConnects
  helperConnects += 1
  const mine = ++helperJob
  closeHelperSocket()
  helper.status = 'connecting'
  awake.onHelperDisconnected()
  emitHelper()
  let rejected = false
  for (let portIndex = 0; portIndex < HELPER_PORTS.length; portIndex++) {
    const port = HELPER_PORTS[portIndex]
    if (mine !== helperJob) return 'cancelled'
    const result = await tryHelperPort(port, code, mine, attempt, portIndex)
    if (mine !== helperJob) return 'cancelled'
    if (result === 'connected') {
      helper.status = 'connected'
      suppressOverlay()
      awake.onHelperConnected()
      emitHelper()
      return 'connected'
    }
    if (result === 'rejected') { rejected = true; break }
  }
  if (mine !== helperJob) return 'cancelled'
  closeHelperSocket()
  helper.status = 'off'
  emitHelper()
  return rejected ? 'rejected' : 'down'
}

function disconnectHelper() {
  helperJob += 1
  closeHelperSocket()
  helper.status = 'off'
  awake.onHelperDisconnected()
  emitHelper()
}

function num(v: unknown) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function clampPos() {
  pos.x = Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - 1))
  pos.y = Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - 1))
}

function paint() {
  const el = cursorEl
  if (!el) return
  el.style.transform = `translate(${pos.x}px, ${pos.y}px)`
  el.classList.toggle('vis', pos.visible)
  el.classList.toggle('laser', pos.laser)
  el.dataset.x = String(Math.round(pos.x))
  el.dataset.y = String(Math.round(pos.y))
  ;(window as unknown as { __ppPointer?: { x: number; y: number; laser: boolean } }).__ppPointer = { x: pos.x, y: pos.y, laser: pos.laser }
}

function armHide() {
  window.clearTimeout(hideTimer)
  if (pos.laser) return
  hideTimer = window.setTimeout(() => { pos.visible = false; paint() }, 4000)
}

function showCursor() {
  pos.visible = true
  paint()
  armHide()
}

function pulse() {
  const el = cursorEl
  if (!el) return
  el.classList.remove('clicked')
  void el.offsetWidth
  el.classList.add('clicked')
}

function codeFor(key: string) {
  if (key === ' ') return 'Space'
  if (key === 'Enter' || key === 'Backspace' || key.startsWith('Arrow') || key.startsWith('Page')) return key
  if (/^[a-zA-Z]$/.test(key)) return 'Key' + key.toUpperCase()
  if (/^[0-9]$/.test(key)) return 'Digit' + key
  return key
}

function dispatchKey(target: EventTarget, key: string) {
  const init: KeyboardEventInit = { key, code: codeFor(key), bubbles: true, cancelable: true, composed: true }
  const down = new KeyboardEvent('keydown', init)
  target.dispatchEvent(down)
  target.dispatchEvent(new KeyboardEvent('keyup', init))
  return down
}

function pageKey(key: string) {
  return dispatchKey(document.body || document, key)
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
  if (desc?.set) desc.set.call(el, value)
  else el.value = value
}

function isTextField(el: HTMLElement) {
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly
  if (el instanceof HTMLInputElement) return !el.disabled && !el.readOnly && !NON_TEXT.has(el.type)
  return el.isContentEditable
}

function textTarget(): HTMLElement | null {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el === document.body || el === document.documentElement) return null
  return isTextField(el) ? el : null
}

function fallbackBox() {
  return document.querySelector<HTMLTextAreaElement>('[data-testid="remote-text"]')
}

function focusTypingTarget(): HTMLElement | null {
  const cur = textTarget()
  if (cur) return cur
  const box = fallbackBox()
  if (!box) return null
  if (document.activeElement !== box) box.focus()
  return box
}

function insertText(el: HTMLElement, text: string) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart
    const end = el.selectionEnd
    if (start == null || end == null) setNativeValue(el, el.value + text)
    else {
      setNativeValue(el, el.value.slice(0, start) + text + el.value.slice(end))
      try { el.setSelectionRange(start + text.length, start + text.length) } catch { /* number/email can reject a range */ }
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }))
    return
  }
  el.focus()
  if (!document.execCommand('insertText', false, text)) {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }))
  }
}

function backspace(el: HTMLElement) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    if (start === 0 && end === 0) return
    const next = start === end ? el.value.slice(0, start - 1) + el.value.slice(end) : el.value.slice(0, start) + el.value.slice(end)
    const caret = start === end ? start - 1 : start
    setNativeValue(el, next)
    try { el.setSelectionRange(Math.max(0, caret), Math.max(0, caret)) } catch { /* ignore */ }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }))
    return
  }
  el.focus()
  document.execCommand('delete')
}

function editField(el: HTMLElement, key: 'Enter' | 'Backspace') {
  if (key === 'Backspace') { backspace(el); return }
  if (el instanceof HTMLTextAreaElement || el.isContentEditable) { insertText(el, '\n'); return }
  if (el instanceof HTMLInputElement) {
    const form = el.form
    window.setTimeout(() => {
      if (!form) return
      if (typeof form.requestSubmit === 'function') form.requestSubmit()
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }, 0)
  }
}

function typeText(text: string) {
  if (!text) return
  const el = focusTypingTarget()
  if (el) insertText(el, text)
  else if ([...text].length === 1) pageKey(text)
}

function pressSpecial(key: 'Enter' | 'Backspace') {
  const field = textTarget()
  if (field) {
    const ev = dispatchKey(field, key)
    if (!ev.defaultPrevented) editField(field, key)
    return
  }
  const active = document.activeElement
  if (key === 'Enter' && active instanceof HTMLButtonElement && !active.disabled) {
    const ev = dispatchKey(active, key)
    if (!ev.defaultPrevented) active.click()
    return
  }
  if (key === 'Backspace') {
    const box = fallbackBox()
    if (box && box.value) {
      box.focus()
      const ev = dispatchKey(box, key)
      if (!ev.defaultPrevented) backspace(box)
      return
    }
  }
  pageKey(key)
}

function hitAt(x: number, y: number): HTMLElement | null {
  for (const n of document.elementsFromPoint(x, y)) {
    if (n instanceof HTMLElement && !n.closest('[data-testid="pointer"]')) return n
  }
  return null
}

function closestEditable(hit: HTMLElement): HTMLElement | null {
  let n: HTMLElement | null = hit
  while (n) {
    if (n.matches('input, textarea, select') || n.isContentEditable) return n
    n = n.parentElement
  }
  return null
}

function clickAt(x: number, y: number, btn: Btn) {
  clampPos()
  showCursor()
  pulse()
  const hit = hitAt(x, y)
  ;(window as unknown as { __ppLastClick?: { x: number; y: number; btn: string; tag: string } }).__ppLastClick = {
    x, y, btn, tag: hit?.tagName || '',
  }
  if (!hit) return
  if (btn === 'right') {
    hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 2, buttons: 2 }))
    return
  }
  const editable = closestEditable(hit)
  if (editable && !(editable as HTMLInputElement).disabled) editable.focus()
  const act = editable || (hit.closest('button, a, label, [role="button"]') as HTMLElement | null) || hit
  const down: MouseEventInit = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 }
  act.dispatchEvent(new MouseEvent('mousedown', down))
  act.dispatchEvent(new MouseEvent('mouseup', { ...down, buttons: 0 }))
  act.click()
}

function canScroll(el: HTMLElement, axis: 'x' | 'y') {
  const style = getComputedStyle(el)
  if (axis === 'y') return el.scrollHeight > el.clientHeight + 2 && /(auto|scroll|overlay)/.test(style.overflowY)
  return el.scrollWidth > el.clientWidth + 2 && /(auto|scroll|overlay)/.test(style.overflowX)
}

function scrollAt(x: number, y: number, dx: number, dy: number) {
  let n = hitAt(x, y)
  while (n && n !== document.body && n !== document.documentElement && !canScroll(n, 'y') && !canScroll(n, 'x')) n = n.parentElement
  const scroller = n && n !== document.body && n !== document.documentElement
    ? n
    : ((document.scrollingElement as HTMLElement | null) || document.documentElement)
  scroller.scrollBy({ left: dx, top: dy, behavior: 'auto' })
}

function moveBy(dx: number, dy: number) {
  if (!dx && !dy) return
  pos.x += dx * MOVE_GAIN
  pos.y += dy * MOVE_GAIN
  clampPos()
  showCursor()
}

function nav(dir: unknown) {
  pageKey(navKey(dir))
}

function LaptopOverlay() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    cursorEl = ref.current
    paint()
    return () => { if (cursorEl === ref.current) cursorEl = null }
  }, [])
  return <div ref={ref} className="ptr" data-testid="pointer" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><path d="M4 2l16 10-7 1.8L9.6 21z" fill="#2A1C16" stroke="#F6F0E6" strokeWidth="1.6" strokeLinejoin="round" /></svg>
    <span className="dot" />
  </div>
}

function LaptopPanel({ ctx }: { ctx: CoreCtx }) {
  const [text, setText] = useState('')
  const link = useHelper()
  const [attempt, setAttempt] = useState<HelperAttempt>(null)

  useEffect(() => {
    if (ctx.link.status !== 'connected') return
    ctx.send({ t: 'remote:helper', on: link.status === 'connected' })
  }, [ctx, ctx.link.status, link.status])

  const mover = moverReported.use()
  const helperOn = link.status === 'connected'
  return <div className="card pad" data-testid="remote-panel">
    <h3 className="h-row"><span><Icon n="keyboard" /> Phone keyboard</span>{text ? <CopyBtn text={text} ctx={ctx} label="Copy" /> : null}</h3>
    <MoverControl
      state={mover}
      qa={qaHooksEnabled(browserSearch())}
      showPip={pictureInPictureEnabled()}
      onToggle={() => {
        if (helperOn) sendHelper({ t: 'mover', ...moverToggleCommand(mover) })
        awake.afterToggle(moverToggleCommand(mover), helperOn)
      }}
      onInterval={(interval) => {
        if (helperOn && mover.on) sendHelper({ t: 'mover', ...moverIntervalCommand(interval) })
        awake.noteInterval(interval)
      }}
      onAutoStop={(preset) => awake.setAutoStop(preset)}
      onPip={() => { void awake.pip() }}
    />
    <textarea data-testid="remote-text" className="clip" rows={2} onChange={(e) => setText(e.target.value)} placeholder="Open Remote on your phone and type. Text lands here, or in the field the pointer focuses." />
    <div className="full-laptop" data-testid="full-laptop">
      <ConnectGuide
        status={link.status}
        attempt={attempt}
        onSubmitCode={(code) => {
          setAttempt(null)
          void connectHelper(code).then((result) => {
            if (result === 'cancelled') return
            setAttempt(result)
          })
        }}
        onDisconnect={() => {
          setAttempt(null)
          disconnectHelper()
        }}
      />
    </div>
  </div>
}

registerFeature({
  id: 'remote',
  title: 'Remote',
  icon: 'pointer',
  order: 40,
  laptopColumn: 'left',
  PhonePage: Remote,
  LaptopPanel,
  LaptopOverlay,
  init: (ctx) => {
    if (ctx.role !== 'host') return
    awake.attach()
    pos.x = window.innerWidth / 2
    pos.y = window.innerHeight / 2
    pos.visible = false
    pos.laser = false
    paint()
    const onResize = () => { clampPos(); paint() }
    const syncLaser = () => { if (!showPointerLaser(ctx.link.status)) suppressOverlay() }
    syncLaser()
    const offStatus = ctx.link.subscribe(syncLaser)
    window.addEventListener('resize', onResize)
    const offs = [
      onMessage('remote:move', (m) => {
        const dx = num(m.dx)
        const dy = num(m.dy)
        if (sendHelper({ t: 'move', dx: dx * MOVE_GAIN, dy: dy * MOVE_GAIN })) return
        moveBy(dx, dy)
      }),
      onMessage('remote:click', (m) => {
        const btn = m.btn === 'right' ? 'right' : 'left'
        if (sendHelper({ t: 'click', btn })) return
        clickAt(pos.x, pos.y, btn)
      }),
      onMessage('remote:scroll', (m) => {
        const dx = Math.max(-500, Math.min(500, num(m.dx)))
        const dy = Math.max(-500, Math.min(500, num(m.dy)))
        if (!dx && !dy) return
        if (sendHelper({ t: 'scroll', dx: dx * SCROLL_GAIN, dy: dy * SCROLL_GAIN })) return
        clampPos()
        scrollAt(pos.x, pos.y, dx * SCROLL_GAIN, dy * SCROLL_GAIN)
        showCursor()
      }),
      onMessage('remote:nav', (m) => {
        if (sendHelper({ t: 'key', key: navKey(m.dir) })) return
        nav(m.dir)
      }),
      onMessage('remote:type', (m) => {
        if (typeof m.text !== 'string') return
        if (helperReady()) {
          const clean = printableRun(m.text)
          for (let i = 0; i < clean.length; i += 200) {
            const text = clean.slice(i, i + 200)
            if (text) sendHelper({ t: 'type', text })
          }
          return
        }
        typeText(m.text)
      }),
      onMessage('remote:key', (m) => {
        const key = String(m.key || '')
        if (!key) return
        if (sendHelper({ t: 'key', key })) return
        if (key === 'Enter' || key === 'Backspace') pressSpecial(key)
        else pageKey(key)
      }),
      onMessage('remote:pointer', (m) => {
        if (helperReady()) {
          suppressOverlay()
          return
        }
        pos.laser = !!m.on
        pos.visible = true
        paint()
        armHide()
      }),
      onMessage('remote:helper', (m) => {
        if (m.ask) ctx.send({ t: 'remote:helper', on: helperReady() })
      }),
      onMessage('mover', (m) => {
        if (m.ask) {
          ctx.send(relayReport(awake.view()))
          return
        }
        const cmd = readRelayCommand(m)
        if (!cmd) return
        if (!('on' in cmd)) {
          awake.setAutoStop(cmd.autoStop)
          return
        }
        if (!cmd.on) {
          if (helperReady()) sendHelper({ t: 'mover', on: false })
          awake.stop({ tellHelper: !helperReady() })
          if (cmd.autoStop) awake.setAutoStop(cmd.autoStop)
          return
        }
        if (cmd.autoStop) awake.setAutoStop(cmd.autoStop)
        if (helperReady()) {
          sendHelper({ t: 'mover', on: true, interval: cmd.interval })
          awake.noteInterval(cmd.interval)
          return
        }
        void awake.start(cmd.interval)
      }),
    ]
    const relay = {
      send: (msg: ReturnType<typeof relayReport>) => ctx.send(msg),
      connected: () => ctx.link.connected,
    }
    moverRelay = relay
    const offLink = ctx.link.subscribe(() => {
      const effect = keepAwakeLinkEffect(ctx.link.status)
      if (effect === 'stop' && moverStopsOn('disconnect')) stopMouseMover()
      if (effect === 'resync') ctx.send(relayReport(awake.view()))
    })
    return () => {
      offs.forEach((off) => off())
      offLink()
      offStatus()
      if (moverRelay === relay) moverRelay = null
      window.removeEventListener('resize', onResize)
      window.clearTimeout(hideTimer)
      awake.detach()
    }
  },
})
