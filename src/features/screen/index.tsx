// Laptop screen on the phone. Messages: screen:request, screen:stop, sc, sc:avail, sc:stop.
// Page turns use remote:nav. Keys while Control is on use remote:key and remote:type.
import React, { useEffect, useRef, useState } from 'react'
import type { MediaConnection } from 'peerjs'
import { createStore, registerFeature, onMessage, onCall, CoreCtx } from '../../core/bus'
import { Icon } from '../../core/icons'
import { Video } from '../../core/ui'
import { download } from '../../core/util'
import {
  DOUBLE_TAP_MS,
  LONG_PRESS_MS,
  frameScale,
  gestureStep,
  mapTouchToContent,
  initialGesture,
  readAvail,
  screenControlNote,
  type Finger,
  type GestureEvent,
} from './map'
import { forwardHelper, helperConnected, stopMouseMover, subscribeHelper } from '../remote'
import { availability, helperCommands, initialControlGate, readDisplaySurface, stepControl, type ControlGate } from './control'
import { SC_EMPTY_HINT, SC_REASON_EMPTY, SC_REASON_HELPER, SC_REASON_SURFACE, SC_SURFACE_HINT, type ScAvailMsg } from './sc'
import './screen.css'

const sharing = createStore(false)
const requested = createStore(false)
const incoming = createStore<MediaStream | null>(null)
const controlAvail = createStore<{ on: boolean; reason?: string } | null>(null)
const controlEpoch = createStore(0)
const stopQuiet = createStore(false)
const controlling = createStore(false)
const availState = createStore<ScAvailMsg>({ t: 'sc:avail', on: false })

let availKey = ''
let availSent = false
let pendingStop = false
let gate: ControlGate = initialControlGate()

function trackSurface(stream: MediaStream | null): string | undefined {
  const track = stream?.getVideoTracks()[0]
  if (!track || track.readyState === 'ended') return undefined
  try { return readDisplaySurface(track.getSettings()) } catch { return undefined }
}

function currentAvail(): ScAvailMsg {
  return availability(helperConnected(), trackSurface(outStream), sharing.get() && !!outStream)
}

function releaseDrag() {
  forwardHelper({ t: 'btn', btn: 'left', state: 'up' })
  forwardHelper({ t: 'btn', btn: 'right', state: 'up' })
}

function endControl(ctx: CoreCtx) {
  if (!controlling.get()) return
  gate = stepControl(gate, { type: 'stop' }).gate
  controlling.set(false)
  releaseDrag()
  if (ctx.link.connected) ctx.send({ t: 'sc:stop' })
  else pendingStop = true
  stopMouseMover()
}

function publishAvail(ctx: CoreCtx, force = false) {
  const msg = currentAvail()
  availState.set(msg)
  if (!sharing.get() && !availSent) return
  const key = `${msg.on}:${msg.reason ?? ''}`
  const changed = key !== availKey || !availSent
  if (!force && !changed) return
  availKey = key
  availSent = true
  if (changed && !msg.on) endControl(ctx)
  if (ctx.link.connected) ctx.send(msg)
}

let outCall: MediaConnection | null = null
let outStream: MediaStream | null = null
let inCall: MediaConnection | null = null
let pendingCall: MediaConnection | null = null
let pendingIn = false
let picking = false

function stopSharing(ctx: CoreCtx, notify: boolean) {
  const stream = outStream
  const call = outCall
  if (!stream && !call) {
    if (sharing.get()) sharing.set(false)
    return
  }
  outStream = null
  outCall = null
  sharing.set(false)
  stream?.getTracks().forEach((t) => t.stop())
  try { call?.close() } catch { /* already closed */ }
  if (notify) ctx.send({ t: 'screen:stop' })
  publishAvail(ctx)
}

async function startSharing(ctx: CoreCtx) {
  if (picking) return
  picking = true
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false })
    stopSharing(ctx, false)
    outStream = stream
    try {
      outCall = ctx.call(stream, 'screen')
    } catch {
      outStream = null
      stream.getTracks().forEach((t) => t.stop())
      ctx.toast('Screen share was cancelled')
      return
    }
    sharing.set(true)
    requested.set(false)
    publishAvail(ctx)
    gate = stepControl(gate, { type: 'share' }).gate
    controlling.set(false)
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (outStream === stream) stopSharing(ctx, true)
    })
  } catch {
    ctx.toast('Screen share was cancelled')
  } finally {
    picking = false
  }
}

function clearIncoming() {
  const call = inCall
  const pending = pendingCall
  inCall = null
  pendingCall = null
  pendingIn = false
  incoming.set(null)
  controlAvail.set(null)
  try { call?.close() } catch { /* already closed */ }
  if (pending && pending !== call) { try { pending.close() } catch { /* already closed */ } }
}

type CandidateStat = RTCStats & { candidateType?: string }

function readStats(stats: RTCStatsReport): { ms: number | null; relay: boolean | null; fps: number | null } {
  let ms: number | null = null
  let relay: boolean | null = null
  let fps: number | null = null
  let remoteId = ''
  const takePair = (p: RTCIceCandidatePairStats) => {
    if (p.remoteCandidateId) remoteId = p.remoteCandidateId
    if (typeof p.currentRoundTripTime === 'number') ms = Math.round(p.currentRoundTripTime * 1000)
  }
  stats.forEach((report) => {
    if (report.type === 'transport') {
      const id = (report as RTCTransportStats).selectedCandidatePairId
      const pair = id ? stats.get(id) : undefined
      if (pair && pair.type === 'candidate-pair') takePair(pair as RTCIceCandidatePairStats)
    }
    if (report.type === 'inbound-rtp') {
      const r = report as RTCInboundRtpStreamStats
      if (r.kind === 'video' && typeof r.framesPerSecond === 'number') fps = Math.round(r.framesPerSecond)
    }
  })
  if (!remoteId) {
    stats.forEach((report) => {
      if (report.type !== 'candidate-pair') return
      const p = report as RTCIceCandidatePairStats
      if (p.nominated && p.state === 'succeeded') takePair(p)
    })
  }
  if (remoteId) {
    const remote = stats.get(remoteId) as CandidateStat | undefined
    if (remote && (remote.type === 'remote-candidate' || remote.type === 'local-candidate') && remote.candidateType) {
      relay = remote.candidateType === 'relay'
    }
  }
  return { ms, relay, fps }
}

function statLine(w: number, h: number, fps: number | null, ms: number | null, relay: boolean | null) {
  const path = relay == null ? '…' : relay ? 'relayed' : 'direct connection'
  return `${w} × ${h} · ${fps == null ? '— fps' : `${fps} fps`} · ${ms == null ? '— ms' : `${ms} ms`} · ${path}`
}

type Zoom = { s: number; x: number; y: number }
type FullVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
  webkitExitFullscreen?: () => void
  webkitDisplayingFullscreen?: boolean
}

function PhonePage({ ctx }: { ctx: CoreCtx }) {
  const stream = incoming.use()
  const [rot, setRot] = useState(0)
  const [z, setZ] = useState<Zoom>({ s: 1, x: 0, y: 0 })
  const [info, setInfo] = useState('')
  const [fs, setFs] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const zRef = useRef(z)
  zRef.current = z
  const rotRef = useRef(rot)
  rotRef.current = rot
  const avail = controlAvail.use()
  const epoch = controlEpoch.use()
  const allowed = avail?.on === true
  const [control, setControl] = useState(false)
  const [kb, setKb] = useState(false)
  const controlRef = useRef(false)
  const allowedRef = useRef(false)
  controlRef.current = control
  allowedRef.current = allowed
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const kbLast = useRef('')
  const gRef = useRef(initialGesture())
  const gen = useRef(0)
  const timers = useRef({ long: 0, click: 0, move: 0 })
  const stopSeen = useRef(epoch)
  const dispatchRef = useRef<(ev: GestureEvent) => void>(() => {})
  const gesture = useRef<{ pinch: boolean; d0: number; s0: number; x0: number; y0: number; px: number; py: number } | null>(null)
  const tap = useRef({ t: 0, x: 0, y: 0 })

  const clearTimer = (key: 'long' | 'click' | 'move') => {
    window.clearTimeout(timers.current[key])
    timers.current[key] = 0
  }
  const releaseControl = (quiet = false) => {
    gen.current += 1
    clearTimer('long')
    clearTimer('click')
    clearTimer('move')
    const step = gestureStep(gRef.current, { type: 'cancel', now: Date.now(), quiet })
    gRef.current = step.state
    if (quiet) return
    for (const effect of step.effects) {
      if (effect.type === 'send') ctxRef.current.send(effect.msg)
    }
  }
  const turnOffRef = useRef<() => void>(() => {})
  turnOffRef.current = () => {
    const quiet = stopQuiet.get()
    controlRef.current = false
    setControl(false)
    setKb(false)
    releaseControl(quiet)
    if (quiet) stopQuiet.set(false)
  }
  const turnOn = () => {
    if (!allowedRef.current) return
    gesture.current = null
    gRef.current = initialGesture()
    controlRef.current = true
    setControl(true)
    ctxRef.current.send({ t: 'sc:start' })
  }

  useEffect(() => {
    if (!allowed) turnOffRef.current()
  }, [allowed])
  useEffect(() => {
    if (stopSeen.current === epoch) return
    stopSeen.current = epoch
    turnOffRef.current()
  }, [epoch])
  useEffect(() => {
    if (!stream) turnOffRef.current()
  }, [stream])
  const releaseRef = useRef(releaseControl)
  releaseRef.current = releaseControl
  useEffect(() => () => { releaseRef.current() }, [])

  useEffect(() => {
    if (ctx.role !== 'guest' || incoming.get() || pendingIn || inCall) return
    ctx.send({ t: 'screen:request' })
  }, [ctx])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const block = (e: TouchEvent) => { if (e.cancelable) e.preventDefault() }
    el.addEventListener('touchmove', block, { passive: false })
    return () => el.removeEventListener('touchmove', block)
  }, [stream])

  useEffect(() => {
    if (!stream) { setInfo(''); setFs(false); return }
    const root = box.current
    const video = root?.querySelector('video') as FullVideo | null
    if (!video || !root) return
    let live = true
    let frames = 0
    let stamp = performance.now()
    let counted = 0
    const onFrame: VideoFrameRequestCallback = () => {
      if (!live) return
      frames++
      video.requestVideoFrameCallback(onFrame)
    }
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(onFrame)
    const syncFs = () => setFs(document.fullscreenElement === root || !!video.webkitDisplayingFullscreen)
    document.addEventListener('fullscreenchange', syncFs)
    video.addEventListener('webkitbeginfullscreen', syncFs)
    video.addEventListener('webkitendfullscreen', syncFs)
    const tick = async () => {
      const now = performance.now()
      const dt = (now - stamp) / 1000
      let localFps: number | null = null
      if (dt >= 0.8) {
        localFps = Math.round(frames / dt)
        counted = localFps
        frames = 0
        stamp = now
      }
      let ms: number | null = null
      let relay: boolean | null = null
      let fps: number | null = localFps ?? (counted || null)
      const pc = inCall?.peerConnection
      if (pc) {
        try {
          const read = readStats(await pc.getStats())
          ms = read.ms
          relay = read.relay
          if (read.fps != null) fps = read.fps
        } catch { /* stats not ready */ }
      }
      if (!live) return
      if (video.videoWidth) setInfo(statLine(video.videoWidth, video.videoHeight, fps, ms, relay))
    }
    const id = window.setInterval(tick, 1000)
    tick()
    return () => {
      live = false
      window.clearInterval(id)
      document.removeEventListener('fullscreenchange', syncFs)
      video.removeEventListener('webkitbeginfullscreen', syncFs)
      video.removeEventListener('webkitendfullscreen', syncFs)
    }
  }, [stream])

  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  const onStart = (e: React.TouchEvent) => {
    if (controlRef.current) return
    if (e.touches.length === 2) {
      gesture.current = { pinch: true, d0: dist(e.touches), s0: zRef.current.s, x0: zRef.current.x, y0: zRef.current.y, px: 0, py: 0 }
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      gesture.current = { pinch: false, d0: 0, s0: zRef.current.s, x0: zRef.current.x, y0: zRef.current.y, px: t.clientX, py: t.clientY }
    }
  }
  const onMove = (e: React.TouchEvent) => {
    if (controlRef.current) return
    const g = gesture.current
    if (!g) return
    if (e.touches.length === 2 && g.pinch && g.d0) {
      const s = Math.max(1, Math.min(5, g.s0 * dist(e.touches) / g.d0))
      setZ((v) => ({ ...v, s }))
    } else if (e.touches.length === 1 && !g.pinch && zRef.current.s > 1) {
      const t = e.touches[0]
      setZ({ s: zRef.current.s, x: g.x0 + t.clientX - g.px, y: g.y0 + t.clientY - g.py })
    }
  }
  const onEnd = (e: React.TouchEvent) => {
    if (controlRef.current) return
    if (e.touches.length > 0) return
    const pinched = !!gesture.current?.pinch
    gesture.current = null
    if (pinched || e.changedTouches.length !== 1) return
    const t = e.changedTouches[0]
    const now = Date.now()
    if (now - tap.current.t < 280 && Math.hypot(t.clientX - tap.current.x, t.clientY - tap.current.y) < 28) {
      setZ({ s: 1, x: 0, y: 0 })
      tap.current.t = 0
    } else tap.current = { t: now, x: t.clientX, y: t.clientY }
  }

  const arm = (key: 'long' | 'click' | 'move', ms: number, kind: 'long' | 'clickDue' | 'moveDue') => {
    clearTimer(key)
    const token = gen.current
    timers.current[key] = window.setTimeout(() => {
      timers.current[key] = 0
      if (token !== gen.current || !controlRef.current) return
      dispatchRef.current({ type: kind, now: Date.now() })
    }, ms)
  }
  const fingerOf = (e: React.PointerEvent): Finger | null => {
    const el = box.current
    const video = el?.querySelector('video')
    if (!el || !video) return null
    const rect = el.getBoundingClientRect()
    const mapped = mapTouchToContent({
      touch: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      frame: { width: rect.width, height: rect.height },
      video: { width: video.videoWidth, height: video.videoHeight },
      scale: frameScale(zRef.current.s, rotRef.current),
      pan: { x: zRef.current.x, y: zRef.current.y },
      rotate: rotRef.current,
    })
    if (!mapped) return null
    return { id: e.pointerId, px: e.clientX, py: e.clientY, nx: mapped.x, ny: mapped.y }
  }
  const dispatch = (ev: GestureEvent) => {
    const step = gestureStep(gRef.current, ev)
    gRef.current = step.state
    for (const effect of step.effects) {
      if (effect.type === 'send') ctxRef.current.send(effect.msg)
      else if (effect.type === 'zoom') {
        zRef.current = { ...zRef.current, s: effect.scale }
        setZ(zRef.current)
      } else if (effect.type === 'armLong') arm('long', LONG_PRESS_MS, 'long')
      else if (effect.type === 'armClick') arm('click', DOUBLE_TAP_MS, 'clickDue')
      else if (effect.type === 'armMove') arm('move', effect.waitMs, 'moveDue')
      else if (effect.type === 'clearLong') clearTimer('long')
      else if (effect.type === 'clearClick') clearTimer('click')
      else if (effect.type === 'clearMove') clearTimer('move')
    }
  }
  dispatchRef.current = dispatch
  const onPtrDown = (e: React.PointerEvent) => {
    if (!controlRef.current || e.button !== 0) return
    e.preventDefault()
    try { box.current?.setPointerCapture(e.pointerId) } catch { /* already captured */ }
    const finger = fingerOf(e)
    if (!finger) return
    dispatch({ type: 'down', finger, now: Date.now(), scale: zRef.current.s })
  }
  const onPtrMove = (e: React.PointerEvent) => {
    if (!controlRef.current) return
    const finger = fingerOf(e)
    if (!finger) return
    dispatch({ type: 'move', finger, now: Date.now(), scale: zRef.current.s })
  }
  const onPtrUp = (e: React.PointerEvent) => {
    if (!controlRef.current) return
    dispatch({ type: 'up', id: e.pointerId, now: Date.now(), at: fingerOf(e) })
  }

  const full = () => {
    const el = box.current
    if (!el) return
    const v = el.querySelector('video') as FullVideo | null
    if (document.fullscreenElement || v?.webkitDisplayingFullscreen) {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
      else v?.webkitExitFullscreen?.()
      return
    }
    const lock = () => {
      const orient = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      try { orient.lock?.('landscape')?.catch(() => {}) } catch { /* unsupported */ }
    }
    if (el.requestFullscreen) el.requestFullscreen().then(lock).catch(() => v?.webkitEnterFullscreen?.())
    else { v?.webkitEnterFullscreen?.(); lock() }
  }
  const snap = () => {
    const v = box.current?.querySelector('video')
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const g = c.getContext('2d')
    if (!g) return
    g.drawImage(v, 0, 0)
    c.toBlob((b) => {
      if (!b) return
      const url = URL.createObjectURL(b)
      download(url, `laptop-screen-${Date.now()}.png`)
      window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    }, 'image/png')
  }
  const stopViewing = () => {
    turnOffRef.current()
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    clearIncoming()
    ctx.send({ t: 'screen:stop' })
    if (history.state?.p) history.back()
  }
  const back = () => { if (history.state?.p) history.back() }

  if (!stream) return <div className="pg center" data-testid="screen-waiting">
    <span className="spin big" />
    <h3>Asked your laptop to share its screen</h3>
    <p className="mut">On the laptop, click <b>Share screen</b> and pick a screen or window.</p>
    <button className="btn ghost" data-testid="screen-ask" onClick={() => ctx.send({ t: 'screen:request' })}>Ask again</button>
  </div>

  const device = (ctx.link.remoteName || 'Laptop').trim() || 'Laptop'
  const note = screenControlNote(control, allowed, avail?.reason)
  return <div className="pp-screen-live" data-testid="screen-live" data-controlling={control ? 'true' : 'false'}>
    <div className="pp-screen-top">
      <button className="iconbtn" aria-label="Back" onClick={back}><Icon n="back" /></button>
      <b className="pp-screen-title">{device} screen</b>
      <span className="pp-live"><i />LIVE</span>
    </div>
    <div
      className={'pp-frame' + (control ? ' controlling' : '')}
      ref={box}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onPointerDown={onPtrDown}
      onPointerMove={onPtrMove}
      onPointerUp={onPtrUp}
      onPointerCancel={onPtrUp}
      onDoubleClick={() => { if (!controlRef.current) setZ({ s: 1, x: 0, y: 0 }) }}
    >
      <div className="pp-frame-inner" style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${frameScale(z.s, rot)}) rotate(${rot}deg)` }}>
        <Video stream={stream} testid="remote-screen" />
      </div>
    </div>
    <p className="pp-stats" data-testid="screen-stats">{info || 'Connecting…'}</p>
    <div className="pp-control">
      <button
        type="button"
        role="switch"
        aria-checked={control}
        aria-label="Control"
        data-testid="screen-control-toggle"
        className={'pp-switch' + (control ? ' on' : '')}
        disabled={!allowed}
        onClick={() => { if (control) turnOffRef.current(); else turnOn() }}
      >
        <span className="pp-knob" aria-hidden="true"><i /></span>
        Control
      </button>
      {control && <button type="button" className="pp-kb-btn" data-testid="screen-keyboard" onClick={() => setKb((v) => { if (!v) kbLast.current = ''; return !v })}><Icon n="keyboard" />Keyboard</button>}
    </div>
    <p className="pp-control-note" data-testid="screen-control-note">{note}</p>
    {control && kb && <form className="pp-kb" onSubmit={(e) => { e.preventDefault(); ctx.send({ t: 'remote:key', key: 'Enter' }); const input = e.currentTarget.elements[0] as HTMLInputElement; input.value = ''; kbLast.current = '' }}>
      <input autoFocus data-testid="screen-kb-input" className="kb" placeholder="Type here, it appears on the laptop" autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" onChange={(e) => {
        const v = e.target.value
        const p = kbLast.current
        let i = 0
        while (i < v.length && i < p.length && v[i] === p[i]) i++
        for (let k = 0; k < p.length - i; k++) ctx.send({ t: 'remote:key', key: 'Backspace' })
        if (v.length > i) ctx.send({ t: 'remote:type', text: v.slice(i) })
        kbLast.current = v
      }} onKeyDown={(e) => { if (e.key === 'Backspace' && !(e.target as HTMLInputElement).value) ctx.send({ t: 'remote:key', key: 'Backspace' }) }} />
    </form>}
    <div className="pp-tools">
      <button className={fs ? 'on' : ''} data-testid="screen-fullscreen" onClick={full}><i><Icon n="screen" /></i>Fullscreen</button>
      <button data-testid="screen-zoom" onClick={() => setZ((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2, x: 0, y: 0 }))}><i><Icon n="zoom" /></i>Zoom</button>
      <button data-testid="screen-rotate" onClick={() => setRot((r) => (r + 90) % 360)}><i><Icon n="rotate" /></i>Rotate</button>
      <button data-testid="screen-snap" onClick={snap}><i><Icon n="image" /></i>Snap</button>
    </div>
    <div className="card pp-hint">
      <span className="pp-hint-ic"><Icon n="rotate" /></span>
      <div><b>Turn your phone sideways</b><small>{control ? 'tap to click · drag to move · two fingers to scroll · pinch to zoom' : 'for a bigger view · pinch to zoom'}</small></div>
    </div>
    <div className="pp-bottom">
      <button className="pp-nav" aria-label="Previous" data-testid="screen-prev" onClick={() => ctx.send({ t: 'remote:nav', dir: 'prev' })}><Icon n="back" /></button>
      <button className="pp-stop" data-testid="stop-viewing" onClick={stopViewing}><Icon n="x" />Stop viewing</button>
      <button className="pp-nav" aria-label="Next" data-testid="screen-next" onClick={() => ctx.send({ t: 'remote:nav', dir: 'next' })}><Icon n="next" /></button>
    </div>
  </div>
}

function ControlBanner({ ctx }: { ctx: CoreCtx }) {
  const on = controlling.use()
  if (!on) return null
  return <div className="pp-control-banner" role="status" aria-live="assertive" data-testid="screen-control-banner">
    <p><strong>Phone is controlling this laptop</strong><small>Primary display only</small><small>Esc stops control only while this PhonePair tab is focused. Ctrl+C in the helper terminal is the global stop.</small></p>
    <button type="button" data-testid="screen-control-stop" onClick={() => endControl(ctx)}>Stop</button>
  </div>
}

function LaptopPanel({ ctx }: { ctx: CoreCtx }) {
  const on = sharing.use()
  const ask = requested.use()
  const offer = availState.use()
  return <>
    {ask && !on && <div className="banner pp-screen-banner" data-testid="screen-banner">
      <Icon n="screen" />
      <span>Your phone wants to see this screen.</span>
      <button className="btn" data-testid="share-screen" onClick={() => startSharing(ctx)}>Share screen</button>
      <button className="btn ghost" onClick={() => requested.set(false)}>Not now</button>
    </div>}
    <button className="tile card act" data-testid="screen-tile" onClick={() => (on ? stopSharing(ctx, true) : startSharing(ctx))}>
      <i><Icon n="screen" /></i>
      <b>{on ? 'Stop sharing' : 'Share screen'}</b>
      <small>{on ? 'Your phone is viewing' : 'Show this screen on phone'}</small>
    </button>
    {on && offer.reason === SC_REASON_EMPTY && <p className="mut small" data-testid="screen-empty-hint">{SC_EMPTY_HINT}</p>}
    {on && offer.reason === SC_REASON_SURFACE && <p className="mut small" data-testid="screen-surface-hint">{SC_SURFACE_HINT}</p>}
    {on && offer.reason === SC_REASON_HELPER && <p className="mut small" data-testid="screen-helper-hint">View only until Full laptop is connected. Primary display only.</p>}
    {on && offer.on && <p className="mut small" data-testid="screen-primary-hint">Primary display only.</p>}
  </>
}

registerFeature({
  id: 'screen',
  title: 'Screen view',
  icon: 'screen',
  order: 70,
  laptopColumn: 'left',
  PhonePage,
  LaptopPanel,
  LaptopOverlay: ControlBanner,
  init: (ctx) => {
    const offCall = onCall('screen', (call) => {
      call.answer()
      pendingCall = call
      pendingIn = true
      if (ctx.role === 'guest' && history.state?.p !== 'screen') ctx.openPage('screen')
      const dropPending = () => {
        if (pendingCall !== call) return
        pendingCall = null
        pendingIn = false
      }
      call.on('stream', (s) => {
        dropPending()
        if (inCall && inCall !== call) { try { inCall.close() } catch { /* replaced */ } }
        inCall = call
        incoming.set(s)
        if (ctx.role === 'guest' && history.state?.p !== 'screen') ctx.openPage('screen')
      })
      call.on('close', () => {
        dropPending()
        if (inCall === call) {
          inCall = null
          incoming.set(null)
          controlAvail.set(null)
        }
      })
      call.on('error', () => {
        dropPending()
        if (inCall === call) clearIncoming()
      })
    })
    const offStop = onMessage('screen:stop', (_m, c) => {
      if (c.role === 'host') stopSharing(c, false)
      else clearIncoming()
    })
    const offAvail = onMessage('sc:avail', (m, c) => {
      if (c.role !== 'guest') return
      controlAvail.set(readAvail(m.on, m.reason))
    })
    const offScStop = onMessage('sc:stop', (_m, c) => {
      if (c.role === 'guest') {
        stopQuiet.set(true)
        controlEpoch.set(controlEpoch.get() + 1)
        return
      }
      endControl(c)
    })
    const offScStart = onMessage('sc:start', (_m, c) => {
      if (c.role !== 'host') return
      const next = stepControl(gate, { type: 'start', avail: currentAvail().on })
      gate = next.gate
      controlling.set(next.gate.controlling)
    })
    const offReq = onMessage('screen:request', (_m, c) => {
      if (c.role !== 'host' || sharing.get()) return
      requested.set(true)
      c.toast('Your phone wants to view this screen')
    })
    const onKey = (e: KeyboardEvent) => {
      if (ctx.role !== 'host' || e.key !== 'Escape') return
      endControl(ctx)
    }
    window.addEventListener('keydown', onKey)
    const offHelper = ctx.role === 'host' ? subscribeHelper(() => publishAvail(ctx)) : () => {}
    const offSc = ctx.role === 'host' ? onMessage('sc', (m, c) => {
      if (c.role !== 'host') return
      const decision = stepControl(gate, { type: 'pointer', avail: currentAvail().on })
      if (!decision.forward) {
        gate = decision.gate
        if (decision.gate.stopped) controlling.set(false)
        return
      }
      const cmds = helperCommands(m)
      if (!cmds.length) return
      let sent = false
      for (const cmd of cmds) {
        if (!forwardHelper(cmd)) break
        sent = true
      }
      if (!sent) return
      gate = decision.gate
      controlling.set(true)
    }) : () => {}
    let linkWasUp = ctx.link.connected
    const unsubLink = ctx.link.subscribe(() => {
      const up = ctx.link.connected
      if (!up) {
        linkWasUp = false
        if (controlling.get()) pendingStop = true
        stopSharing(ctx, false)
        clearIncoming()
        return
      }
      if (!linkWasUp) {
        linkWasUp = true
        if (pendingStop) {
          pendingStop = false
          ctx.send({ t: 'sc:stop' })
          stopMouseMover()
        }
        publishAvail(ctx, true)
      }
    })
    return () => {
      offCall(); offStop(); offAvail(); offScStop(); offScStart(); offReq(); offSc(); offHelper(); unsubLink()
      window.removeEventListener('keydown', onKey)
      stopSharing(ctx, false)
      clearIncoming()
      requested.set(false)
      controlEpoch.set(0)
      stopQuiet.set(false)
      gate = initialControlGate()
      controlling.set(false)
      availSent = false
      availKey = ''
      pendingStop = false
      availState.set({ t: 'sc:avail', on: false })
    }
  },
})
