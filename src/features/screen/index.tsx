// Laptop screen on the phone. Messages: screen:request, screen:stop. Page turns use remote:nav.
import React, { useEffect, useRef, useState } from 'react'
import type { MediaConnection } from 'peerjs'
import { createStore, registerFeature, onMessage, onCall, CoreCtx } from '../../core/bus'
import { Icon } from '../../core/icons'
import { Video } from '../../core/ui'
import { download } from '../../core/util'
import { forwardHelper, helperConnected, subscribeHelper } from '../remote'
import { availability, helperCommands, readDisplaySurface } from './control'
import { SC_REASON_HELPER, SC_REASON_SURFACE, type ScAvailMsg } from './sc'
import './screen.css'

const sharing = createStore(false)
const requested = createStore(false)
const incoming = createStore<MediaStream | null>(null)
const controlling = createStore(false)
const availState = createStore<ScAvailMsg>({ t: 'sc:avail', on: false })

let availKey = ''
let availSent = false
let pendingStop = false

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
  controlling.set(false)
  releaseDrag()
  if (ctx.link.connected) ctx.send({ t: 'sc:stop' })
  else pendingStop = true
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
  const gesture = useRef<{ pinch: boolean; d0: number; s0: number; x0: number; y0: number; px: number; py: number } | null>(null)
  const tap = useRef({ t: 0, x: 0, y: 0 })

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
    if (e.touches.length === 2) {
      gesture.current = { pinch: true, d0: dist(e.touches), s0: zRef.current.s, x0: zRef.current.x, y0: zRef.current.y, px: 0, py: 0 }
    } else if (e.touches.length === 1) {
      const t = e.touches[0]
      gesture.current = { pinch: false, d0: 0, s0: zRef.current.s, x0: zRef.current.x, y0: zRef.current.y, px: t.clientX, py: t.clientY }
    }
  }
  const onMove = (e: React.TouchEvent) => {
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
  const fit = rot % 180 === 0 ? 1 : 10 / 16
  return <div className="pp-screen-live" data-testid="screen-live">
    <div className="pp-screen-top">
      <button className="iconbtn" aria-label="Back" onClick={back}><Icon n="back" /></button>
      <b className="pp-screen-title">{device} screen</b>
      <span className="pp-live"><i />LIVE</span>
    </div>
    <div
      className="pp-frame"
      ref={box}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onDoubleClick={() => setZ({ s: 1, x: 0, y: 0 })}
    >
      <div className="pp-frame-inner" style={{ transform: `translate(${z.x}px, ${z.y}px) scale(${z.s * fit}) rotate(${rot}deg)` }}>
        <Video stream={stream} testid="remote-screen" />
      </div>
    </div>
    <p className="pp-stats" data-testid="screen-stats">{info || 'Connecting…'}</p>
    <div className="pp-tools">
      <button className={fs ? 'on' : ''} data-testid="screen-fullscreen" onClick={full}><i><Icon n="screen" /></i>Fullscreen</button>
      <button data-testid="screen-zoom" onClick={() => setZ((v) => (v.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2, x: 0, y: 0 }))}><i><Icon n="zoom" /></i>Zoom</button>
      <button data-testid="screen-rotate" onClick={() => setRot((r) => (r + 90) % 360)}><i><Icon n="rotate" /></i>Rotate</button>
      <button data-testid="screen-snap" onClick={snap}><i><Icon n="image" /></i>Snap</button>
    </div>
    <div className="card pp-hint">
      <span className="pp-hint-ic"><Icon n="rotate" /></span>
      <div><b>Turn your phone sideways</b><small>for a bigger view · pinch to zoom</small></div>
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
    <p><strong>Phone is controlling this laptop</strong><small>Primary display only</small></p>
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
    {on && offer.reason === SC_REASON_SURFACE && <p className="mut small" data-testid="screen-surface-hint">Share your entire screen to control it</p>}
    {on && offer.reason === SC_REASON_HELPER && <p className="mut small" data-testid="screen-helper-hint">View only until Full laptop is connected. Primary display only.</p>}
    {on && offer.on && <p className="mut small" data-testid="screen-primary-hint">Primary display only.</p>}
  </>
}

registerFeature({
  id: 'screen',
  title: 'Screen view',
  icon: 'screen',
  order: 70,
  laptopColumn: 'right',
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
      if (!currentAvail().on) return
      const cmds = helperCommands(m)
      if (!cmds.length) return
      let sent = false
      for (const cmd of cmds) {
        if (!forwardHelper(cmd)) break
        sent = true
      }
      if (sent && currentAvail().on) controlling.set(true)
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
        }
        publishAvail(ctx, true)
      }
    })
    return () => {
      offCall(); offStop(); offReq(); offSc(); offHelper(); unsubLink()
      window.removeEventListener('keydown', onKey)
      stopSharing(ctx, false)
      clearIncoming()
      requested.set(false)
      controlling.set(false)
      availSent = false
      availKey = ''
      pendingStop = false
      availState.set({ t: 'sc:avail', on: false })
    }
  },
})
