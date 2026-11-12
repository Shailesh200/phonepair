// One phone remote. Trackpad, clicker, and pointer share one connection
// and one send path on a single screen.
import React, { useEffect, useRef, useState } from 'react'
import type { CoreCtx } from '../../core/bus'
import { useMessage } from '../../core/bus'
import { Icon } from '../../core/icons'
import { MoverControl } from './Mover'
import { createRemoteSend, type RemoteSend } from './send'
import { remotePageClass, remoteScrollClass, remoteStyles } from './styles'
import { moverIntervalCommand, moverToggleCommand, readMoverState } from '../screen/mover'
import { KEEP_AWAKE_IDLE, browserSearch, qaHooksEnabled, readRelayReport, type KeepAwakeViewState } from './keepAwake'

export type PadGesture = {
  pts: Map<number, { x: number; y: number }>
  accX: number
  accY: number
  scrX: number
  scrY: number
  raf: number
  down: number
  moved: number
  multi: boolean
}

export type StripGesture = { raf: number; acc: number }

/** Drop fingers, a pending frame, and leftover deltas when the pointer toggles. */
export function clearPadGesture(s: PadGesture, cancel: (id: number) => void, strip: StripGesture) {
  s.pts.clear()
  if (s.raf) cancel(s.raf)
  s.raf = 0
  s.accX = 0
  s.accY = 0
  s.scrX = 0
  s.scrY = 0
  s.moved = 0
  s.multi = false
  if (strip.raf) cancel(strip.raf)
  strip.raf = 0
  strip.acc = 0
}

function useSharedSend(ctx: CoreCtx) {
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const channel = useRef<RemoteSend | null>(null)
  if (channel.current === null) channel.current = createRemoteSend((msg) => ctxRef.current.send(msg))
  return channel.current
}

export function Remote({ ctx, className }: { ctx: CoreCtx; className?: string }) {
  const [kb, setKb] = useState(true)
  const [fingers, setFingers] = useState<{ id: number; x: number; y: number }[]>([])
  const [stripOn, setStripOn] = useState(false)
  const pad = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const focusTimer = useRef(0)
  const st = useRef<PadGesture>({ pts: new Map(), accX: 0, accY: 0, scrX: 0, scrY: 0, raf: 0, down: 0, moved: 0, multi: false })
  const last = useRef('')
  const stripAcc = useRef(0)
  const stripRaf = useRef(0)
  const linked = ctx.link.remoteName || 'Connecting…'
  const [fullLaptop, setFullLaptop] = useState(false)
  const [mover, setMover] = useState<KeepAwakeViewState>(KEEP_AWAKE_IDLE)
  const send = useSharedSend(ctx)
  useMessage('remote:helper', (m) => { if (typeof m.on === 'boolean') setFullLaptop(m.on) })
  useMessage('mover', (m) => {
    const relay = readRelayReport(m)
    if (relay) { setMover(relay); return }
    const next = readMoverState(m)
    if (next) setMover({ ...KEEP_AWAKE_IDLE, on: next.on, interval: next.interval })
  })

  useEffect(() => {
    if (ctx.link.status === 'connected') {
      send.helper({ ask: true })
      send.mover({ ask: true })
    }
  }, [ctx, ctx.link.status, send])
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
  const releasePad = () => {
    const strip = { raf: stripRaf.current, acc: stripAcc.current }
    clearPadGesture(st.current, (id) => cancelAnimationFrame(id), strip)
    stripRaf.current = strip.raf
    stripAcc.current = strip.acc
  }
  useEffect(() => () => {
    releasePad()
    send.pointer(false)
  }, [send])

  const flush = () => {
    const s = st.current
    s.raf = 0
    if (s.scrX || s.scrY) { send.scroll(Math.round(s.scrX), Math.round(s.scrY)); s.scrX = 0; s.scrY = 0 }
    if (s.accX || s.accY) { send.move(Math.round(s.accX), Math.round(s.accY)); s.accX = 0; s.accY = 0 }
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
      if (!s.multi && s.moved < 10 && Date.now() - s.down < 350) send.click('left')
      s.multi = false
    }
  }
  const point = (on: boolean) => {
    releasePad()
    setFingers([])
    setStripOn(false)
    send.pointer(on)
  }
  useEffect(() => {
    const leavePage = () => {
      point(false)
      releasePad()
      for (const id of ['lclick', 'rclick']) pageRef.current?.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.blur()
    }
    const onHide = () => { if (document.visibilityState === 'hidden') leavePage() }
    document.addEventListener('visibilitychange', onHide)
    document.addEventListener('freeze', leavePage)
    window.addEventListener('pagehide', leavePage)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      document.removeEventListener('freeze', leavePage)
      window.removeEventListener('pagehide', leavePage)
    }
  }, [send])

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
      if (dy) send.scroll(0, dy)
    })
  }
  const onStripUp = (e: React.PointerEvent) => {
    setStripOn(false)
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }

  return <div className={remotePageClass(className)} data-remote-name={linked} ref={pageRef}>
    {fullLaptop ? <span className={remoteStyles.badge} data-testid="full-laptop-badge">Full laptop</span> : null}
    <div id="pp-trackpad" ref={pad} className={remoteStyles.pad} data-testid="trackpad" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()}>
      <div className={remoteStyles.hint}>
        <Icon n="pointer" />
        <p>Swipe to move · tap to click<br />two fingers to scroll</p>
      </div>
      {fingers.map((f) => <span key={f.id} className={remoteStyles.finger} style={{ left: f.x, top: f.y }} />)}
      <div className={remoteScrollClass(stripOn)} role="scrollbar" aria-orientation="vertical" aria-label="Scroll" aria-controls="pp-trackpad" data-testid="scroll-strip" onPointerDown={onStripDown} onPointerMove={onStripMove} onPointerUp={onStripUp} onPointerCancel={onStripUp}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v18" /><path d="m8 7 4-4 4 4" /><path d="m8 17 4 4 4-4" /></svg>
      </div>
    </div>
    <div className={remoteStyles.clicks}>
      <button type="button" className={remoteStyles.left} data-testid="lclick" onClick={() => send.click('left')}>Left click</button>
      <button type="button" className={remoteStyles.right} data-testid="rclick" onClick={() => send.click('right')}>Right click</button>
    </div>
    <div className={remoteStyles.clicker}>
      <button type="button" className={remoteStyles.prev} data-testid="prev" onClick={() => send.nav('prev')}><Icon n="back" />Prev</button>
      <button type="button" className={remoteStyles.next} data-testid="next" onClick={() => send.nav('next')}>Next<Icon n="next" /></button>
    </div>
    <button type="button" className={remoteStyles.laser} data-testid="pointer" onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); point(true) }} onPointerUp={(e) => { point(false); try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ } }} onPointerCancel={() => point(false)} onBlur={() => point(false)} onLostPointerCapture={() => point(false)}>Pointer · hold to point</button>
    <MoverControl
      state={mover}
      qa={qaHooksEnabled(browserSearch())}
      onToggle={() => {
        const cmd = moverToggleCommand(mover)
        send.mover({ ...cmd, autoStop: mover.autoStop })
      }}
      onInterval={(interval) => {
        if (mover.mode === 'helper' && mover.on) send.mover({ ...moverIntervalCommand(interval), autoStop: mover.autoStop })
      }}
      onAutoStop={(preset) => {
        if (mover.on) send.mover({ on: true, interval: mover.interval ?? '1m', autoStop: preset })
        else send.mover({ autoStop: preset })
      }}
    />
    <button type="button" className={remoteStyles.keyboard} data-testid="kb-toggle" onClick={() => setKb((v) => { if (!v) last.current = ''; return !v })}><Icon n="keyboard" />Keyboard</button>
    {kb && <form className={remoteStyles.form} onSubmit={(e) => { e.preventDefault(); send.key('Enter'); const input = e.currentTarget.elements[0] as HTMLInputElement; input.value = ''; last.current = '' }}>
      <input autoFocus data-testid="kb-input" className={remoteStyles.input} placeholder="Type here, it appears on the laptop" autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" onFocus={(e) => revealInput(e.currentTarget)} onChange={(e) => {
        const v = e.target.value
        const p = last.current
        let i = 0
        while (i < v.length && i < p.length && v[i] === p[i]) i++
        for (let k = 0; k < p.length - i; k++) send.key('Backspace')
        if (v.length > i) send.type(v.slice(i))
        last.current = v
      }} onKeyDown={(e) => { if (e.key === 'Backspace' && !(e.target as HTMLInputElement).value) send.key('Backspace') }} />
    </form>}
  </div>
}
