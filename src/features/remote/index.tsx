// Phone as a remote for this tab. Messages: remote:move, remote:click, remote:scroll,
// remote:nav, remote:type, remote:key, remote:pointer.
import React, { useEffect, useRef, useState } from 'react'
import { CoreCtx, onMessage, registerFeature, useMessage } from '../../core/bus'
import { Icon } from '../../core/icons'
import { CopyBtn } from '../../core/ui'
import { helperProbeTimeout, settleHelperProbe, type HelperProbeSocket } from './helperProbe'
import './remote.css'

const MOVE_GAIN = 1.6
const SCROLL_GAIN = 2
const NON_TEXT = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'image', 'hidden'])

type Btn = 'left' | 'right'
type Tab = 'trackpad' | 'clicker' | 'pointer'

const HELPER_PORTS = [47811, 47812, 47813, 47814]
const HELPER_DOWN_NOTE = "Couldn't reach the helper. Make sure it's running, and click Allow if Chrome asks about local network access, then try again."
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
      ws.onclose = () => {
        if (helper.ws !== ws) return
        helper.ws = null
        helper.status = 'off'
        emitHelper()
      }
    },
  })
}

async function connectHelper(code: string): Promise<HelperResult> {
  const attempt = helperConnects
  helperConnects += 1
  const mine = ++helperJob
  closeHelperSocket()
  helper.status = 'connecting'
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
  const prev = dir === 'prev'
  pageKey(prev ? 'ArrowLeft' : 'ArrowRight')
  pageKey(prev ? 'PageUp' : 'PageDown')
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
  const [code, setCode] = useState('')
  const [note, setNote] = useState('')
  const armed = link.status === 'connected' || link.status === 'connecting'

  useEffect(() => {
    if (ctx.link.status !== 'connected') return
    ctx.send({ t: 'remote:helper', on: link.status === 'connected' })
  }, [ctx, ctx.link.status, link.status])

  const toggle = () => {
    if (armed) {
      setNote('')
      disconnectHelper()
      return
    }
    if (!/^\d{6}$/.test(code)) {
      setNote('Enter the 6-digit code printed by the helper.')
      return
    }
    setNote('')
    void connectHelper(code).then((result) => {
      if (result === 'cancelled' || result === 'connected') return
      if (result === 'rejected') setNote('That code was rejected. Check the helper window and try again.')
      else setNote(HELPER_DOWN_NOTE)
    })
  }

  const statusText = link.status === 'connected' ? 'Connected' : link.status === 'connecting' ? 'Connecting…' : 'Not connected'
  return <div className="card pad" data-testid="remote-panel">
    <h3 className="h-row"><span><Icon n="keyboard" /> Phone keyboard</span>{text ? <CopyBtn text={text} ctx={ctx} label="Copy" /> : null}</h3>
    <textarea data-testid="remote-text" className="clip" rows={2} onChange={(e) => setText(e.target.value)} placeholder="Open Remote on your phone and type. Text lands here, or in the field the pointer focuses." />
    <div className="full-laptop" data-testid="full-laptop">
      <div className="full-laptop-row">
        <div>
          <b>Full laptop</b>
          <p className={'mut small helper-status' + (link.status === 'connected' ? ' on' : '')} data-testid="helper-status" aria-live="polite">{statusText}</p>
        </div>
        <button type="button" className={'switch' + (armed ? ' on' : '')} role="switch" aria-checked={armed} aria-label="Full laptop" data-testid="full-laptop-toggle" onClick={toggle}><span /></button>
      </div>
      {link.status !== 'connected' && <>
        <p className="mut small" data-testid="helper-hint">Download the PhonePair Helper, open it, and type the 6-digit code it shows.</p>
        <p className="helper-downloads">
          <a className="linkbtn sm" href="https://github.com/Shailesh200/phonepair/releases/latest/download/PhonePair-Helper-mac.dmg" target="_blank" rel="noreferrer" data-testid="download-mac">Download for Mac</a>
          <a className="linkbtn sm" href="https://github.com/Shailesh200/phonepair/releases/latest/download/PhonePair-Helper-win.exe" target="_blank" rel="noreferrer" data-testid="download-win">Download for Windows</a>
        </p>
        <p className="mut small" data-testid="mac-open-steps">{'Open the DMG, drag PhonePair Helper to Applications, and open it. Allow Accessibility when asked so Control works.'}</p>
        <p className="mut small" data-testid="win-open-steps">{'If SmartScreen appears, click More info, then Run anyway.'}</p>
        <input className="helper-code" data-testid="helper-code" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={6} placeholder="6-digit code" aria-label="Helper code" value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setNote('') }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); toggle() } }} />
      </>}
      {note ? <p className="err">{note}</p> : null}
    </div>
    <p className="mut small helper-dev-note" data-testid="helper-dev-note">or run from source: <code>cd helper && npm start</code></p>
    {link.status === 'connected' ? <p className="mut small">Your phone controls the whole laptop. Turn Full laptop off to keep control inside this tab.</p> : null}
  </div>
}

function PhonePage({ ctx }: { ctx: CoreCtx }) {
  const [tab, setTab] = useState<Tab>('trackpad')
  const [kb, setKb] = useState(false)
  const [fingers, setFingers] = useState<{ id: number; x: number; y: number }[]>([])
  const [stripOn, setStripOn] = useState(false)
  const pad = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const focusTimer = useRef(0)
  const st = useRef({ pts: new Map<number, { x: number; y: number }>(), accX: 0, accY: 0, scrX: 0, scrY: 0, raf: 0, down: 0, moved: 0, multi: false })
  const last = useRef('')
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const stripAcc = useRef(0)
  const stripRaf = useRef(0)
  const linked = ctx.link.remoteName || 'Connecting…'
  const [fullLaptop, setFullLaptop] = useState(false)
  useMessage('remote:helper', (m) => { if (typeof m.on === 'boolean') setFullLaptop(m.on) })

  useEffect(() => {
    if (ctx.link.status === 'connected') ctx.send({ t: 'remote:pointer', on: tab === 'pointer' })
  }, [tab, ctx, ctx.link.status])
  useEffect(() => {
    if (ctx.link.status === 'connected') ctx.send({ t: 'remote:helper', ask: true })
  }, [ctx, ctx.link.status])
  useEffect(() => {
    const page = pageRef.current?.closest('.phone-page') as HTMLElement | null
    if (!page) return
    const apply = () => {
      const vv = window.visualViewport
      const h = vv ? vv.height : window.innerHeight
      page.style.setProperty('--vvh', `${Math.round(h)}px`)
      const input = document.activeElement
      if (input instanceof HTMLElement && input.dataset.testid === 'kb-input') {
        requestAnimationFrame(() => input.scrollIntoView({ block: 'nearest' }))
      }
    }
    apply()
    const vv = window.visualViewport
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      window.clearTimeout(focusTimer.current)
      page.style.removeProperty('--vvh')
    }
  }, [])
  const revealInput = (el: HTMLElement) => {
    window.clearTimeout(focusTimer.current)
    requestAnimationFrame(() => {
      focusTimer.current = window.setTimeout(() => el.scrollIntoView({ block: 'nearest' }), 50)
    })
  }
  useEffect(() => () => {
    const s = st.current
    if (s.raf) cancelAnimationFrame(s.raf)
    if (stripRaf.current) cancelAnimationFrame(stripRaf.current)
    ctxRef.current.send({ t: 'remote:pointer', on: false })
  }, [])

  const flush = () => {
    const s = st.current
    s.raf = 0
    const send = ctxRef.current.send
    if (s.scrX || s.scrY) { send({ t: 'remote:scroll', dx: Math.round(s.scrX), dy: Math.round(s.scrY) }); s.scrX = 0; s.scrY = 0 }
    if (s.accX || s.accY) { send({ t: 'remote:move', dx: Math.round(s.accX), dy: Math.round(s.accY) }); s.accX = 0; s.accY = 0 }
  }
  const queue = () => { const s = st.current; if (!s.raf) s.raf = requestAnimationFrame(flush) }

  const placeFinger = (id: number, e: React.PointerEvent) => {
    const box = pad.current?.getBoundingClientRect()
    if (!box) return
    const x = e.clientX - box.left
    const y = e.clientY - box.top
    setFingers((fs) => {
      const i = fs.findIndex((f) => f.id === id)
      if (i < 0) return [...fs, { id, x, y }]
      const next = fs.slice()
      next[i] = { id, x, y }
      return next
    })
  }

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.pad-scroll')) return
    e.preventDefault()
    pad.current?.setPointerCapture(e.pointerId)
    const s = st.current
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (s.pts.size === 1) { s.down = Date.now(); s.moved = 0; s.multi = false } else s.multi = true
    placeFinger(e.pointerId, e)
  }
  const onMove = (e: React.PointerEvent) => {
    const s = st.current
    const p = s.pts.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY })
    s.moved += Math.abs(dx) + Math.abs(dy)
    placeFinger(e.pointerId, e)
    if (s.pts.size >= 2) {
      s.multi = true
      s.scrX += dx / s.pts.size
      s.scrY += dy / s.pts.size
      queue()
      return
    }
    s.accX += dx
    s.accY += dy
    queue()
  }
  const onUp = (e: React.PointerEvent) => {
    const s = st.current
    s.pts.delete(e.pointerId)
    setFingers((fs) => fs.filter((f) => f.id !== e.pointerId))
    if (s.pts.size === 0) {
      if (!s.multi && s.moved < 10 && Date.now() - s.down < 350) ctxRef.current.send({ t: 'remote:click', btn: 'left' })
      s.multi = false
    }
  }

  const onStripDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setStripOn(true)
    stripAcc.current = 0
    ;(e.currentTarget as HTMLElement).dataset.y = String(e.clientY)
  }
  const onStripMove = (e: React.PointerEvent) => {
    const host = e.currentTarget as HTMLElement
    if (!host.hasPointerCapture(e.pointerId)) return
    const prev = Number(host.dataset.y || e.clientY)
    host.dataset.y = String(e.clientY)
    stripAcc.current += (e.clientY - prev) * 1.8
    if (!stripRaf.current) stripRaf.current = requestAnimationFrame(() => {
      stripRaf.current = 0
      const dy = Math.round(stripAcc.current)
      stripAcc.current = 0
      if (dy) ctxRef.current.send({ t: 'remote:scroll', dx: 0, dy })
    })
  }
  const onStripUp = (e: React.PointerEvent) => {
    setStripOn(false)
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  return <div className="pg remote" data-remote-name={linked} ref={pageRef}>
    {fullLaptop ? <span className="tag ok" data-testid="full-laptop-badge">Full laptop</span> : null}
    <div className="seg" role="tablist" aria-label="Remote mode">
      {(['trackpad', 'clicker', 'pointer'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} data-testid={`rtab-${t}`} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'trackpad' ? 'Trackpad' : t === 'clicker' ? 'Clicker' : 'Pointer'}</button>)}
    </div>
    {tab === 'clicker' ? <div className="clicker-help card"><Icon n="slides" size={40} /><p>Prev and Next send arrow and page keys to the laptop, so a slideshow open in this tab can flip.</p></div> : <>
      <div id="pp-trackpad" ref={pad} className="pad-area" data-testid="trackpad" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()}>
        <div className="pad-hint">
          <Icon n="pointer" />
          {tab === 'pointer'
            ? <p>Swipe to move the pointer<br />tap to click · two fingers to scroll</p>
            : <p>Swipe to move · tap to click<br />two fingers to scroll</p>}
        </div>
        {fingers.map((f) => <span key={f.id} className="touch-dot" style={{ left: f.x, top: f.y }} />)}
        <div className={'pad-scroll' + (stripOn ? ' on' : '')} role="scrollbar" aria-orientation="vertical" aria-label="Scroll" aria-controls="pp-trackpad" data-testid="scroll-strip" onPointerDown={onStripDown} onPointerMove={onStripMove} onPointerUp={onStripUp} onPointerCancel={onStripUp}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v18" /><path d="m8 7 4-4 4 4" /><path d="m8 17 4 4 4-4" /></svg>
        </div>
      </div>
      <div className="two clicks">
        <button type="button" className="btn ghost big" data-testid="lclick" onClick={() => ctx.send({ t: 'remote:click', btn: 'left' })}>Left click</button>
        <button type="button" className="btn ghost big" data-testid="rclick" onClick={() => ctx.send({ t: 'remote:click', btn: 'right' })}>Right click</button>
      </div>
    </>}
    <div className={'two nav2' + (tab === 'clicker' ? ' tall' : '')}>
      <button type="button" className="btn soft big" data-testid="prev" onClick={() => ctx.send({ t: 'remote:nav', dir: 'prev' })}><Icon n="back" />Prev</button>
      <button type="button" className="btn big" data-testid="next" onClick={() => ctx.send({ t: 'remote:nav', dir: 'next' })}>Next<Icon n="next" /></button>
    </div>
    <button type="button" className="btn ghost big kb-btn" data-testid="kb-toggle" onClick={() => setKb((v) => { if (!v) last.current = ''; return !v })}><Icon n="keyboard" />Keyboard</button>
    {kb && <form className="kb-form" onSubmit={(e) => { e.preventDefault(); ctx.send({ t: 'remote:key', key: 'Enter' }); const input = e.currentTarget.elements[0] as HTMLInputElement; input.value = ''; last.current = '' }}>
      <input autoFocus data-testid="kb-input" className="kb" placeholder="Type here, it appears on the laptop" autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" onFocus={(e) => revealInput(e.currentTarget)} onChange={(e) => {
        const v = e.target.value
        const p = last.current
        let i = 0
        while (i < v.length && i < p.length && v[i] === p[i]) i++
        for (let k = 0; k < p.length - i; k++) ctx.send({ t: 'remote:key', key: 'Backspace' })
        if (v.length > i) ctx.send({ t: 'remote:type', text: v.slice(i) })
        last.current = v
      }} onKeyDown={(e) => { if (e.key === 'Backspace' && !(e.target as HTMLInputElement).value) ctx.send({ t: 'remote:key', key: 'Backspace' }) }} />
    </form>}
  </div>
}

registerFeature({
  id: 'remote',
  title: 'Remote',
  icon: 'pointer',
  order: 40,
  laptopColumn: 'right',
  PhonePage,
  LaptopPanel,
  LaptopOverlay,
  init: (ctx) => {
    if (ctx.role !== 'host') return
    pos.x = window.innerWidth / 2
    pos.y = window.innerHeight / 2
    pos.visible = false
    pos.laser = false
    paint()
    const onResize = () => { clampPos(); paint() }
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
        if (helperReady()) {
          const prev = m.dir === 'prev'
          sendHelper({ t: 'key', key: prev ? 'ArrowLeft' : 'ArrowRight' })
          sendHelper({ t: 'key', key: prev ? 'PageUp' : 'PageDown' })
          return
        }
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
    ]
    return () => {
      offs.forEach((off) => off())
      window.removeEventListener('resize', onResize)
      window.clearTimeout(hideTimer)
    }
  },
})
