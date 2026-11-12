/** Browser keep-awake on the laptop page. The helper path stays in index.tsx. */

import type { MoverCommand, MoverInterval, MoverState } from '../screen/mover.ts'
import {
  activeMode,
  createAutoStopClock,
  currentTimeScale,
  deriveStatus,
  keepAwakeSwitchOn,
  type AutoStop,
  type KeepAwakeViewState,
} from './keepAwake.ts'
import { TINY_MP4 } from './keepAwakeMedia.ts'

export type KeepAwakeHost = {
  helperConnected: () => boolean
  sendHelper: (msg: { t: 'mover'; on: boolean; interval?: MoverInterval }) => void
  publish: (state: KeepAwakeViewState) => void
}

type Caps = { wakeLockApi: boolean; videoApi: boolean }

type Session = {
  requested: boolean
  interval: MoverInterval
  autoStop: AutoStop
  helperOn: boolean
  localEngaged: boolean
  pending: boolean
  settled: boolean
  wakeLockHeld: boolean
  videoPlaying: boolean
  pipActive: boolean
  tabHidden: boolean
  helperStopped: boolean
  wakeLockApi: boolean
  videoApi: boolean
}

function detectCaps(): Caps {
  let wakeLockApi = false
  let videoApi = false
  try {
    wakeLockApi = typeof navigator !== 'undefined' && 'wakeLock' in navigator && navigator.wakeLock != null
  } catch { /* private mode or a test realm without navigator */ }
  try {
    const capture = typeof HTMLCanvasElement !== 'undefined'
      && typeof HTMLCanvasElement.prototype.captureStream === 'function'
    const canVideo = typeof document !== 'undefined' && typeof document.createElement === 'function'
    videoApi = Boolean(canVideo && (capture || TINY_MP4.length > 0))
  } catch { /* ignore */ }
  return { wakeLockApi, videoApi }
}

function tabHidden() {
  try { return typeof document !== 'undefined' && document.hidden } catch { return false }
}

export function createBrowserKeepAwake(host: KeepAwakeHost) {
  const caps = detectCaps()
  const session: Session = {
    requested: false,
    interval: '1m',
    autoStop: 'never',
    helperOn: false,
    localEngaged: false,
    pending: false,
    settled: false,
    wakeLockHeld: false,
    videoPlaying: false,
    pipActive: false,
    tabHidden: tabHidden(),
    helperStopped: false,
    wakeLockApi: caps.wakeLockApi,
    videoApi: caps.videoApi,
  }

  let epoch = 0
  let quiet = false
  let reacquiring = false
  let lastGood: 'On (screen awake)' | null = null
  let videoGen = 0
  let sentinel: WakeLockSentinel | null = null
  let video: HTMLVideoElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let drawTimer: number | null = null
  let audio: { ctx: AudioContext; osc: OscillatorNode } | null = null
  let onVisible: (() => void) | null = null

  function view(): KeepAwakeViewState {
    const helperConnected = host.helperConnected()
    const holding = session.wakeLockHeld || session.videoPlaying || session.pipActive
    const failed = session.helperStopped || (session.settled && session.requested && !holding && !session.tabHidden && !session.helperOn)
    const mode = activeMode({
      helperConnected,
      wakeLockHeld: session.wakeLockHeld,
      videoPlaying: session.videoPlaying,
      pipActive: session.pipActive,
      wakeLockApi: session.wakeLockApi,
      videoApi: session.videoApi,
      failed,
    })
    const status = deriveStatus({
      requested: session.requested,
      helperConnected,
      helperReportedOn: session.helperOn,
      wakeLockHeld: session.wakeLockHeld,
      videoPlaying: session.videoPlaying,
      pipActive: session.pipActive,
      tabHidden: session.tabHidden,
      settled: session.settled,
      reacquiring,
      lastGood,
      helperStopped: session.helperStopped,
    })
    if (status === 'On (screen awake)') lastGood = 'On (screen awake)'
    return {
      on: keepAwakeSwitchOn(status),
      interval: session.interval,
      status,
      mode,
      autoStop: session.autoStop,
    }
  }

  function publish() {
    if (quiet) return
    host.publish(view())
  }

  const clock = createAutoStopClock({
    setTimer: (fn, ms) => (typeof window === 'undefined' ? 0 : window.setTimeout(fn, ms)),
    clearTimer: (id) => { if (typeof window !== 'undefined') window.clearTimeout(id) },
    scale: currentTimeScale(),
    onFire: () => { stop({ tellHelper: true }) },
  })

  function releaseWakeLock() {
    const current = sentinel
    sentinel = null
    session.wakeLockHeld = false
    if (!current) return
    void current.release().catch(() => undefined)
  }

  function stopAudio() {
    const current = audio
    audio = null
    if (!current) return
    try { current.osc.stop() } catch { /* already stopped */ }
    try { void current.ctx.close() } catch { /* already closed */ }
  }

  function stopDraw() {
    if (drawTimer == null || typeof window === 'undefined') return
    window.clearInterval(drawTimer)
    drawTimer = null
  }

  function stopVideo() {
    quiet = true
    videoGen += 1
    stopDraw()
    session.videoPlaying = false
    session.pipActive = false
    const el = video
    video = null
    canvas = null
    if (el && typeof document !== 'undefined' && document.pictureInPictureElement === el) {
      void document.exitPictureInPicture().catch(() => undefined)
    }
    if (el) {
      try { el.pause() } catch { /* ignore */ }
      el.srcObject = null
      el.removeAttribute('src')
      el.remove()
    }
    quiet = false
  }

  function releaseMedia() {
    releaseWakeLock()
    stopAudio()
    session.wakeLockHeld = false
    stopVideo()
  }

  function startDraw() {
    if (drawTimer != null || !canvas || typeof window === 'undefined') return
    const target = canvas
    drawTimer = window.setInterval(() => {
      const g = target.getContext('2d')
      if (!g) return
      g.fillStyle = (Date.now() / 1000 | 0) % 2 ? '#101010' : '#141414'
      g.fillRect(0, 0, target.width, target.height)
    }, 1000)
  }

  function canvasStream(doc: Document): MediaStream | null {
    if (typeof HTMLCanvasElement === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null
    const el = doc.createElement('canvas')
    el.width = 8
    el.height = 8
    const g = el.getContext('2d')
    if (!g) return null
    g.fillStyle = '#101010'
    g.fillRect(0, 0, 8, 8)
    try {
      const stream = el.captureStream(1)
      canvas = el
      return stream
    } catch {
      return null
    }
  }

  function buildVideo(doc: Document, gen: number): HTMLVideoElement | null {
    const el = doc.createElement('video')
    el.muted = true
    el.defaultMuted = true
    el.loop = true
    el.playsInline = true
    el.autoplay = true
    el.volume = 0
    el.setAttribute('muted', '')
    el.setAttribute('playsinline', '')
    el.setAttribute('webkit-playsinline', 'true')
    el.setAttribute('aria-hidden', 'true')
    el.tabIndex = -1
    el.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none'
    const stream = canvasStream(doc)
    if (stream) el.srcObject = stream
    else if (TINY_MP4) el.src = TINY_MP4
    else return null
    const mine = gen
    el.addEventListener('play', () => {
      if (mine !== videoGen || !session.requested) return
      session.videoPlaying = true
      publish()
    })
    el.addEventListener('pause', () => {
      if (mine !== videoGen) return
      session.videoPlaying = false
      if (!session.requested) return
      publish()
    })
    el.addEventListener('enterpictureinpicture', () => {
      if (mine !== videoGen) return
      session.pipActive = true
      publish()
    })
    el.addEventListener('leavepictureinpicture', () => {
      if (mine !== videoGen) return
      session.pipActive = false
      if (!session.requested) return
      publish()
    })
    doc.body.appendChild(el)
    startDraw()
    return el
  }

  function ensureVideo(mine: number): Promise<boolean> {
    if (typeof document === 'undefined') return Promise.resolve(false)
    if (!video) {
      video = buildVideo(document, videoGen)
      if (!video) return Promise.resolve(false)
    }
    let ready: Promise<void>
    try { ready = video.play() } catch { return Promise.resolve(false) }
    return ready.then(() => {
      if (mine !== epoch) return false
      session.videoPlaying = !!video && !video.paused
      return session.videoPlaying
    }).catch(() => {
      if (mine !== epoch) return false
      session.videoPlaying = false
      return false
    })
  }

  function startAudio() {
    if (audio || typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return
    try {
      const ctx = new window.AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      gain.gain.value = 0
      osc.frequency.value = 1
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      audio = { ctx, osc }
      void ctx.resume().catch(() => undefined)
    } catch { /* autoplay policy, or no audio device */ }
  }

  async function acquireWakeLock(mine: number): Promise<boolean> {
    if (!session.wakeLockApi || typeof navigator === 'undefined' || !navigator.wakeLock) return false
    try {
      const next = await navigator.wakeLock.request('screen')
      if (mine !== epoch) {
        void next.release().catch(() => undefined)
        return false
      }
      sentinel = next
      session.wakeLockHeld = true
      stopVideo()
      next.addEventListener('release', () => {
        if (sentinel !== next) return
        sentinel = null
        session.wakeLockHeld = false
        const recover = session.requested && !session.helperOn && !host.helperConnected() && !tabHidden()
        if (recover) reacquiring = true
        publish()
        if (!recover) return
        const held = epoch
        void ensureVideo(held).then((playing) => {
          if (held !== epoch) return
          reacquiring = false
          if (session.wakeLockHeld || tabHidden()) {
            if (session.wakeLockHeld) stopVideo()
            publish()
            return
          }
          session.videoPlaying = playing
          publish()
        })
      })
      return true
    } catch {
      session.wakeLockHeld = false
      return false
    }
  }

  function armIfRunning() {
    if (session.requested && !session.pending) clock.arm()
  }

  async function start(interval: MoverInterval) {
    const mine = ++epoch
    reacquiring = false
    session.helperStopped = false
    session.interval = interval
    session.requested = true
    session.localEngaged = true
    session.helperOn = false
    session.pending = true
    session.settled = false
    session.tabHidden = tabHidden()
    clock.clear()
    publish()
    if (host.helperConnected()) {
      session.pending = false
      session.localEngaged = false
      host.sendHelper({ t: 'mover', on: true, interval })
      if (mine === epoch) clock.arm()
      publish()
      return
    }
    startAudio()
    const locked = await acquireWakeLock(mine)
    if (mine !== epoch) return
    session.wakeLockHeld = locked
    if (!locked) {
      const playing = await ensureVideo(mine)
      if (mine !== epoch) return
      session.videoPlaying = playing
    }
    session.pending = false
    session.settled = true
    session.localEngaged = true
    clock.arm()
    publish()
  }

  function stop(opts?: { tellHelper?: boolean }) {
    epoch += 1
    reacquiring = false
    lastGood = null
    session.helperStopped = false
    session.requested = false
    session.helperOn = false
    session.localEngaged = false
    session.pending = false
    session.settled = false
    clock.clear()
    releaseMedia()
    if (opts?.tellHelper !== false) host.sendHelper({ t: 'mover', on: false })
    publish()
  }

  function setAutoStop(preset: AutoStop) {
    session.autoStop = preset
    clock.select(preset)
    armIfRunning()
    publish()
  }

  function noteInterval(interval: MoverInterval) {
    session.interval = interval
  }

  function afterToggle(cmd: MoverCommand, helperTold: boolean) {
    if (!cmd.on) {
      stop({ tellHelper: !helperTold })
      return
    }
    session.interval = cmd.interval
    if (helperTold) return
    void start(cmd.interval)
  }

  function noteHelperReport(state: MoverState) {
    reacquiring = false
    session.helperStopped = false
    if (state.interval) session.interval = state.interval
    if (state.on) {
      epoch += 1
      session.helperOn = true
      session.requested = true
      session.localEngaged = false
      session.pending = false
      session.settled = true
      releaseMedia()
      clock.arm()
      publish()
      return
    }
    epoch += 1
    lastGood = null
    session.helperOn = false
    session.requested = false
    session.localEngaged = false
    session.pending = false
    session.settled = false
    clock.clear()
    releaseMedia()
    publish()
  }

  function onHelperDisconnected() {
    reacquiring = false
    const helperWasOn = session.helperOn
    session.helperOn = false
    if (session.localEngaged && session.requested) {
      publish()
      return
    }
    epoch += 1
    lastGood = null
    session.helperStopped = helperWasOn
    session.requested = false
    session.pending = false
    session.settled = false
    clock.clear()
    releaseMedia()
    publish()
  }

  function onHelperConnected() {
    session.helperStopped = false
    if (session.requested && session.localEngaged && !session.helperOn) {
      host.sendHelper({ t: 'mover', on: true, interval: session.interval })
    }
    publish()
  }

  function onVisibility() {
    session.tabHidden = tabHidden()
    const again = session.requested && !session.helperOn && !host.helperConnected() && !session.tabHidden
    reacquiring = again
    publish()
    if (!again) return
    const mine = epoch
    void acquireWakeLock(mine).then((locked) => {
      if (mine !== epoch) return
      if (tabHidden()) {
        reacquiring = false
        publish()
        return
      }
      session.wakeLockHeld = locked
      if (locked) {
        reacquiring = false
        stopVideo()
        publish()
        return
      }
      publish()
      void ensureVideo(mine).then((playing) => {
        if (mine !== epoch) return
        reacquiring = false
        if (tabHidden() || session.wakeLockHeld) {
          if (session.wakeLockHeld) stopVideo()
          publish()
          return
        }
        session.videoPlaying = playing
        publish()
      })
    })
  }

  function attach() {
    if (onVisible || typeof document === 'undefined') return
    onVisible = () => { void onVisibility() }
    document.addEventListener('visibilitychange', onVisible)
  }

  function detach() {
    if (!onVisible) return
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    onVisible = null
    stop({ tellHelper: true })
  }

  async function pip() {
    let enabled = false
    try { enabled = typeof document !== 'undefined' && document.pictureInPictureEnabled === true } catch { enabled = false }
    if (!enabled) return
    try {
      if (!video && session.requested) video = buildVideo(document, videoGen)
      if (!video || typeof video.requestPictureInPicture !== 'function') return
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture()
        return
      }
      // play() and requestPictureInPicture() stay in this click's gesture.
      // The first click used to start playback and return before PiP could open.
      await video.play()
      await video.requestPictureInPicture()
    } catch { /* no Picture-in-Picture here, or the browser refused the gesture */ }
  }

  publish()

  return {
    view,
    start,
    stop,
    setAutoStop,
    noteInterval,
    afterToggle,
    noteHelperReport,
    onHelperDisconnected,
    onHelperConnected,
    pip,
    attach,
    detach,
  }
}
