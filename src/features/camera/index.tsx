// Phone as camera, mic, and scanner. Messages: cam:stop. Media kinds: 'camera', 'mic'.
import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import type { MediaConnection } from 'peerjs'
import { CoreCtx, createStore, onCall, onMessage, registerFeature } from '../../core/bus'
import { Icon } from '../../core/icons'
import { Video } from '../../core/ui'
import { copyText, download } from '../../core/util'
import { sendFiles } from '../files'
import { sendText } from '../text'
import { classifyCode, codeHref } from './classify'
import { imageFileToJpeg, jpegsToPdf } from './pdf'

type Kind = 'camera' | 'mic'
type Facing = 'environment' | 'user'
type Live = { camera: MediaStream | null; mic: MediaStream | null }
type Slot = { call: MediaConnection; stream: MediaStream | null }

const remoteMedia = createStore<Live>({ camera: null, mic: null })
const incoming = new Map<Kind, Slot>()
const phoneStoppers = new Map<Kind, () => void>()

function bindPhoneStop(kind: Kind, fn: () => void) {
  phoneStoppers.set(kind, fn)
  return () => { if (phoneStoppers.get(kind) === fn) phoneStoppers.delete(kind) }
}

function setRemote(kind: Kind, stream: MediaStream | null) {
  remoteMedia.set((s) => (s[kind] === stream ? s : { ...s, [kind]: stream }))
}

function dropIncoming(kind: Kind) {
  const slot = incoming.get(kind)
  if (!slot) { setRemote(kind, null); return }
  incoming.delete(kind)
  try { slot.call.close() } catch { /* already closed */ }
  slot.stream?.getTracks().forEach((t) => t.stop())
  setRemote(kind, null)
}

function acceptCall(kind: Kind, call: MediaConnection) {
  dropIncoming(kind)
  const slot: Slot = { call, stream: null }
  incoming.set(kind, slot)
  const mine = () => incoming.get(kind) === slot
  call.on('stream', (stream) => {
    if (!mine()) { stream.getTracks().forEach((t) => t.stop()); return }
    slot.stream = stream
    setRemote(kind, stream)
    stream.getTracks().forEach((t) => t.addEventListener('ended', () => { if (mine() && slot.stream === stream) dropIncoming(kind) }))
  })
  call.on('close', () => { if (mine()) dropIncoming(kind) })
  call.on('error', () => { if (mine()) dropIncoming(kind) })
  try { call.answer() } catch { dropIncoming(kind) }
}

function onStop(m: { kind?: unknown }, ctx: CoreCtx) {
  const kind = m.kind
  if (kind !== 'camera' && kind !== 'mic') return
  if (ctx.role === 'host') dropIncoming(kind)
  else phoneStoppers.get(kind)?.()
}

function stopKind(ctx: CoreCtx, kind: Kind) {
  dropIncoming(kind)
  ctx.send({ t: 'cam:stop', kind })
}

function mediaError(what: 'camera' | 'microphone', e: unknown): string {
  const name = (e as { name?: string })?.name || ''
  const noun = what === 'camera' ? 'Camera' : 'Microphone'
  if (!window.isSecureContext || name === 'SecurityError') {
    return `${noun} needs a secure page. Open PhonePair with https, then try again.`
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return `${noun} access is blocked. Allow it for this site in the browser settings, then try again.`
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return `No ${what} was found on this device.`
  }
  if (name === 'NotReadableError') return `The ${what} is already in use by another app. Close that app, then try again.`
  if (!navigator.mediaDevices?.getUserMedia) return `This browser can't open the ${what}. Try the latest Safari or Chrome.`
  return `The ${what} didn't start. Check that it isn't covered or in use, then try again.`
}

const LOOK = `
.pp-shot{position:relative;border-radius:20px;overflow:hidden;background:#fff;border:1px solid #E7E9F0}
.pp-shot video{width:100%;display:block;aspect-ratio:3/4;max-height:58vh;object-fit:cover;background:#111}
.pp-shot.wide video{aspect-ratio:16/9;max-height:none;object-fit:contain;background:#0F172A}
.pp-shot.off{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;border:0}
.pp-live{position:absolute;top:12px;left:12px;z-index:2;background:#fff;border-radius:999px;padding:5px 10px;box-shadow:0 4px 14px rgba(15,23,42,.15)}
.pp-flip{position:absolute;top:12px;right:12px;z-index:2;width:44px;height:44px;border-radius:50%;background:#fff;border:1px solid #E7E9F0;display:grid;place-items:center;box-shadow:0 4px 14px rgba(15,23,42,.15)}
.pp-flip svg{width:20px;height:20px}
.pp-ring{position:relative;width:176px;height:176px;margin:8px auto;display:grid;place-items:center}
.pp-mic{width:112px;height:112px;border-radius:50%;background:#4F46E5;color:#fff;display:grid;place-items:center;box-shadow:0 14px 30px -12px rgba(79,70,229,.75)}
.pp-mic svg{width:42px;height:42px}
.pp-mic.off{background:#fff;color:#4F46E5;border:1px solid #E7E9F0;box-shadow:none}
.pp-guide{position:absolute;inset:12% 10%;border-radius:16px;pointer-events:none;box-shadow:0 0 0 999px rgba(15,23,42,.38)}
.pp-guide i{position:absolute;width:28px;height:28px;border:3px solid #fff;display:block}
.pp-shutter{width:78px;height:78px;border-radius:50%;margin:0 auto;padding:0;border:4px solid #4F46E5;background:#fff;display:grid;place-items:center}
.pp-shutter span{width:60px;height:60px;border-radius:50%;background:#4F46E5;display:block}
.pp-shutter:disabled{opacity:.4}
.pp-strip{display:flex;gap:10px;overflow-x:auto;padding:2px 0 8px}
.pp-strip .scan-pg{width:76px;flex:none}
.pp-note{font-size:15px;font-weight:650;line-height:1.45}
`
function Look() { return <style>{LOOK}</style> }

function Blocked({ text, onRetry, testid }: { text: string; onRetry: () => void; testid?: string }) {
  return <div className="card pad">
    <p className="pp-note">{text}</p>
    <button className="btn big" style={{ marginTop: 16 }} data-testid={testid} onClick={onRetry}>Try again</button>
  </div>
}

async function openCapture(kind: Kind, facing: Facing): Promise<MediaStream> {
  if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { name: 'SecurityError' })
  const md = navigator.mediaDevices
  if (!md?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'SecurityError' })
  if (kind === 'mic') {
    try {
      return await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
    } catch (e) {
      const n = (e as { name?: string }).name
      if (n === 'OverconstrainedError' || n === 'ConstraintNotSatisfiedError') return md.getUserMedia({ audio: true, video: false })
      throw e
    }
  }
  const video = (mode: 'exact' | 'ideal'): MediaTrackConstraints => ({
    facingMode: mode === 'exact' ? { exact: facing } : { ideal: facing },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  })
  try {
    return await md.getUserMedia({ audio: false, video: video('exact') })
  } catch (e) {
    const n = (e as { name?: string }).name
    if (n === 'OverconstrainedError' || n === 'NotFoundError' || n === 'ConstraintNotSatisfiedError') {
      return md.getUserMedia({ audio: false, video: video('ideal') })
    }
    throw e
  }
}

function Capture({ ctx, kind }: { ctx: CoreCtx; kind: Kind }) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [err, setErr] = useState('')
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(true)
  const seq = useRef(0)
  const callRef = useRef<MediaConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const facingRef = useRef<Facing>('environment')
  const [muted, setMuted] = useState(false)
  const level = useLevel(kind === 'mic' ? stream : null, kind === 'mic' && live && !muted, false)

  const release = (notify: boolean, update: boolean) => {
    seq.current++
    const call = callRef.current
    const s = streamRef.current
    callRef.current = null
    streamRef.current = null
    try { call?.close() } catch { /* ignore */ }
    s?.getTracks().forEach((t) => t.stop())
    if (update) { setStream(null); setLive(false); setBusy(false); setMuted(false) }
    if (notify) ctxRef.current.send({ t: 'cam:stop', kind })
  }

  const start = async (face?: Facing) => {
    const which = face ?? facingRef.current
    if (face) facingRef.current = face
    const my = ++seq.current
    setErr('')
    setBusy(true)
    try {
      const s = await openCapture(kind, which)
      if (my !== seq.current) { s.getTracks().forEach((t) => t.stop()); return }
      const prevCall = callRef.current
      const prevStream = streamRef.current
      callRef.current = null
      streamRef.current = null
      try { prevCall?.close() } catch { /* ignore */ }
      prevStream?.getTracks().forEach((t) => t.stop())
      const call = ctxRef.current.call(s, kind)
      if (my !== seq.current) { try { call.close() } catch { /* ignore */ }; s.getTracks().forEach((t) => t.stop()); return }
      call.on('close', () => { if (callRef.current === call) release(false, true) })
      callRef.current = call
      streamRef.current = s
      s.getAudioTracks().forEach((t) => { t.enabled = true })
      setMuted(false)
      setStream(s)
      setLive(true)
    } catch (e) {
      if (my !== seq.current) return
      setStream(null)
      setLive(false)
      setErr(mediaError(kind === 'mic' ? 'microphone' : 'camera', e))
    } finally {
      if (my === seq.current) setBusy(false)
    }
  }

  useEffect(() => {
    const off = bindPhoneStop(kind, () => release(false, true))
    void start()
    return () => { off(); release(true, false) }
    // start once per visit; later starts come from the buttons
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  useEffect(() => {
    if (ctx.link.status !== 'connected') release(false, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.link.status])

  const flip = () => {
    const next: Facing = (facingRef.current === 'user' ? 'environment' : 'user')
    void start(next)
  }
  const toggleMute = () => {
    const next = !muted
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next })
    setMuted(next)
  }

  if (kind === 'mic') {
    return <div className="pg">
      <Look />
      {err ? <Blocked text={err} testid="start-stream" onRetry={() => void start()} /> : <>
        <div className="card pad" style={{ textAlign: 'center' }}>
          <MicRing level={level} muted={!live || muted} />
          <p className="mut small">{live ? (muted ? 'Muted. Your laptop cannot hear this phone.' : `Your laptop can hear this phone.`) : (busy ? 'Turning the microphone on…' : 'Microphone is off.')}</p>
          {!live && !busy && <button className="btn big" style={{ marginTop: 14 }} data-testid="start-stream" onClick={() => void start()}>Try again</button>}
        </div>
        {live && <button className="btn ghost big" aria-pressed={muted} onClick={toggleMute}>{muted ? 'Unmute' : 'Mute'}</button>}
        {live && <button className="btn danger big" data-testid="stop-stream" onClick={() => release(true, true)}>Stop</button>}
      </>}
    </div>
  }

  return <div className="pg">
    <Look />
    {err ? <Blocked text={err} testid="start-stream" onRetry={() => void start()} /> : stream ? <>
      <div className="pp-shot">
        <Video stream={stream} testid="local-camera" />
        <span className="live pp-live">● LIVE</span>
        <button className="pp-flip" aria-label="Flip camera" onClick={flip}><Icon n="flip" /></button>
      </div>
      <p className="mut small">Streaming to {ctx.link.remoteName || 'your laptop'}.</p>
      <button className="btn danger big" data-testid="stop-stream" onClick={() => release(true, true)}>Stop</button>
    </> : <div className="card pad" style={{ textAlign: 'center', padding: '42px 20px' }}>
      <span className="spin" />
      <p className="mut" style={{ marginTop: 14 }}>{busy ? 'Turning the camera on…' : 'Camera is off.'}</p>
      {!busy && <button className="btn big" style={{ marginTop: 16 }} data-testid="start-stream" onClick={() => void start()}>Try again</button>}
    </div>}
  </div>
}

function MicRing({ level, muted }: { level: number; muted: boolean }) {
  const r = 76
  const circ = 2 * Math.PI * r
  const shown = muted ? 0 : Math.max(0, Math.min(1, level / 100))
  return <div className="pp-ring">
    <svg width="176" height="176" viewBox="0 0 176 176" style={{ position: 'absolute', transform: 'rotate(-90deg)' }} aria-hidden="true">
      <circle cx="88" cy="88" r={r} fill="none" stroke="#EEF2FF" strokeWidth="8" />
      <circle cx="88" cy="88" r={r} fill="none" stroke="#4F46E5" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${Math.max(shown * circ, shown ? 8 : 0)} ${circ}`} />
    </svg>
    <div className={'pp-mic' + (muted ? ' off' : '')}><Icon n="mic" /></div>
  </div>
}

function snapshot(v: HTMLVideoElement | null) {
  if (!v?.videoWidth) return
  const c = document.createElement('canvas')
  c.width = v.videoWidth
  c.height = v.videoHeight
  const g = c.getContext('2d')
  if (!g) return
  g.drawImage(v, 0, 0)
  c.toBlob((b) => {
    if (!b) return
    const url = URL.createObjectURL(b)
    download(url, `phone-camera-${Date.now()}.jpg`)
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, 'image/jpeg', 0.92)
}

function fullscreen(el: HTMLVideoElement | null) {
  if (!el) return
  const v = el as HTMLVideoElement & { webkitEnterFullscreen?: () => void }
  if (typeof v.webkitEnterFullscreen === 'function') { v.webkitEnterFullscreen(); return }
  v.requestFullscreen?.().catch(() => {})
}

function CameraCard({ ctx, stream }: { ctx: CoreCtx; stream: MediaStream }) {
  const box = useRef<HTMLDivElement>(null)
  const video = () => box.current?.querySelector('video') ?? null
  return <div className="card pad" ref={box}>
    <Look />
    <h3 className="h-row"><span><Icon n="camera" /> Phone camera</span><span className="live">● LIVE</span></h3>
    <div className="pp-shot wide"><Video stream={stream} testid="remote-camera" /></div>
    <p className="mut small" style={{ marginTop: 12 }}>Share this window or tab in Zoom, Meet, or Teams to use the phone as a webcam. OBS can capture the window and send it as a virtual camera.</p>
    <div className="row-g">
      <button className="btn ghost sm" onClick={() => snapshot(video())}>Snapshot</button>
      <button className="btn ghost sm" onClick={() => fullscreen(video())}>Fullscreen</button>
    </div>
    <button className="btn danger big" style={{ marginTop: 12 }} onClick={() => stopKind(ctx, 'camera')}>Stop</button>
  </div>
}

let meterCtx: AudioContext | null = null

function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    el.muted = false
    let gone = false
    el.play().then(() => { if (!gone) { meterCtx?.resume().catch(() => {}); setBlocked(false) } }).catch(() => { if (!gone) setBlocked(true) })
    return () => { gone = true; el.pause(); el.srcObject = null }
  }, [stream])
  return <>
    <audio ref={ref} autoPlay data-testid="remote-mic" style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }} />
    {blocked && <button className="btn" style={{ marginBottom: 12 }} data-testid="listen" onClick={() => {
      meterCtx?.resume().catch(() => {})
      ref.current?.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
    }}>Click to listen</button>}
  </>
}

function useLevel(stream: MediaStream | null, active: boolean, publish: boolean) {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    if (!stream || !active) { setPct(0); return }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    let ac: AudioContext
    try { ac = new AC() } catch { return }
    if (publish) meterCtx = ac
    let src: MediaStreamAudioSourceNode
    try { src = ac.createMediaStreamSource(stream) } catch { ac.close().catch(() => {}); return }
    const an = ac.createAnalyser()
    an.fftSize = 512
    src.connect(an)
    const data = new Uint8Array(an.fftSize)
    let raf = 0
    let last = -1
    const kick = () => { ac.resume().catch(() => {}) }
    if (ac.state === 'suspended') window.addEventListener('pointerdown', kick, { once: true })
    const tick = () => {
      an.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v }
      const next = Math.max(0, Math.min(100, Math.round(Math.sqrt(sum / data.length) * 280)))
      if (next !== last) { last = next; setPct(next) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', kick)
      src.disconnect()
      if (publish && meterCtx === ac) meterCtx = null
      ac.close().catch(() => {})
    }
  }, [stream, active, publish])
  return pct
}

function MicCard({ ctx, stream }: { ctx: CoreCtx; stream: MediaStream }) {
  const level = useLevel(stream, true, true)
  return <div className="card pad">
    <Look />
    <h3 className="h-row"><span><Icon n="mic" /> Phone mic</span><span className="live">● LIVE</span></h3>
    <RemoteAudio stream={stream} />
    <MicRing level={level} muted={false} />
    <p className="mut small">This is your phone's microphone, playing in this tab. Leave the tab open while you use it.</p>
    <button className="btn danger big" style={{ marginTop: 12 }} onClick={() => stopKind(ctx, 'mic')}>Stop</button>
  </div>
}

function CameraPanel({ ctx }: { ctx: CoreCtx }) {
  const { camera, mic } = remoteMedia.use()
  if (camera) return <CameraCard ctx={ctx} stream={camera} />
  if (mic) return null
  return <div className="card pad">
    <h3 className="h-row"><span><Icon n="camera" /> Phone camera</span></h3>
    <p className="mut small">Nothing live yet. On your phone, tap Camera, Mic, or Scan.</p>
  </div>
}

function MicPanel({ ctx }: { ctx: CoreCtx }) {
  const mic = remoteMedia.use().mic
  if (!mic) return null
  return <MicCard ctx={ctx} stream={mic} />
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts?: { formats?: string[] }): { detect: (src: CanvasImageSource) => Promise<{ rawValue?: string }[]> }
      getSupportedFormats?: () => Promise<string[]>
    }
  }
}

const WANT_FORMATS = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'code_93', 'upc_a', 'upc_e', 'itf', 'codabar', 'data_matrix', 'pdf417', 'aztec']
type JsQR = (data: Uint8ClampedArray, width: number, height: number, opts?: { inversionAttempts?: 'dontInvert' }) => { data: string } | null
let jsqrPromise: Promise<JsQR> | null = null
function loadJsQR() {
  if (!jsqrPromise) {
    jsqrPromise = import('jsqr').then((m) => {
      const fn = m.default
      if (typeof fn !== 'function') throw new Error('QR reader failed to load')
      return fn
    }).catch((e) => { jsqrPromise = null; throw e })
  }
  return jsqrPromise
}

async function makeDetector() {
  const BD = window.BarcodeDetector
  if (!BD) return null
  try {
    let formats: string[] | undefined
    if (BD.getSupportedFormats) {
      const supported = await BD.getSupportedFormats()
      const picked = WANT_FORMATS.filter((f) => supported.includes(f))
      formats = picked.length ? picked : supported
    }
    return new BD(formats ? { formats } : undefined)
  } catch { return null }
}

async function readFrame(video: HTMLVideoElement, det: { detect: (src: CanvasImageSource) => Promise<{ rawValue?: string }[]> } | null, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D | null, dropDet: () => void): Promise<string | null> {
  if (det) {
    try {
      const codes = await det.detect(video)
      return codes.find((c) => c.rawValue)?.rawValue?.trim() || null
    } catch { dropDet() }
  }
  if (!g || !video.videoWidth) return null
  const w = Math.min(video.videoWidth, 720)
  const h = Math.max(1, Math.round(video.videoHeight * (w / video.videoWidth)))
  canvas.width = w
  canvas.height = h
  g.drawImage(video, 0, 0, w, h)
  let img: ImageData
  try { img = g.getImageData(0, 0, w, h) } catch { return null }
  const jsQR = await loadJsQR()
  return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data?.trim() || null
}

function CodeScan({ ctx }: { ctx: CoreCtx }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState(false)
  const [err, setErr] = useState('')
  const [value, setValue] = useState<string | null>(null)

  useEffect(() => {
    if (value) return
    let dead = false
    let stream: MediaStream | null = null
    let timer = 0
    const canvas = document.createElement('canvas')
    const g = canvas.getContext('2d', { willReadFrequently: true })
    const stopTracks = () => {
      window.clearInterval(timer)
      stream?.getTracks().forEach((t) => t.stop())
      stream = null
      if (videoRef.current) videoRef.current.srcObject = null
    }
    setErr('')
    setPreview(false)
    ;(async () => {
      try {
        stream = await openCapture('camera', 'environment')
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return }
        const video = videoRef.current
        if (video) { video.srcObject = stream; await video.play().catch(() => {}) }
        if (dead) { stopTracks(); return }
        setPreview(true)
        let det = await makeDetector()
        let busy = false
        timer = window.setInterval(() => {
          if (dead || busy) return
          const v = videoRef.current
          if (!v || v.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
          busy = true
          readFrame(v, det, canvas, g, () => { det = null }).then((text) => {
            busy = false
            if (dead || !text) return
            setValue(text)
            setPreview(false)
            stopTracks()
          }).catch(() => { busy = false })
        }, 300)
      } catch (e) {
        if (!dead) setErr(mediaError('camera', e))
      }
    })()
    return () => { dead = true; stopTracks() }
  }, [attempt, value])

  const href = value ? codeHref(value) : null
  const kind = value ? classifyCode(value) : null
  const show = preview && !err && !value
  return <>
    <div className={'pp-shot' + (show ? '' : ' off')}>
      <video ref={videoRef} autoPlay muted playsInline data-testid="scan-preview" />
      {show && <span className="live pp-live">● LIVE</span>}
    </div>
    {err && <Blocked text={err} onRetry={() => setAttempt((n) => n + 1)} />}
    {!err && !value && !preview && <div className="card pad" style={{ textAlign: 'center', padding: '42px 20px' }}><span className="spin" /><p className="mut" style={{ marginTop: 14 }}>Turning the camera on…</p></div>}
    {show && <p className="mut small">Point the rear camera at a QR code or barcode. It is read on this phone.</p>}
    {value && <div className="card pad">
      <h3>{kind === 'url' ? 'Link' : 'Code'}</h3>
      <p className="txt" data-testid="scan-result">{value}</p>
      <div className="stack" style={{ marginTop: 12 }}>
        <button className="btn big" onClick={() => { sendText(ctx, value); ctx.toast('Sent to your laptop') }}>Send to laptop</button>
        {href
          ? <div className="two">
              <a className="btn ghost big" href={href} target="_blank" rel="noopener noreferrer">Open</a>
              <button className="btn ghost big" onClick={async () => ctx.toast((await copyText(value)) ? 'Copied' : 'Copy blocked by browser')}>Copy</button>
            </div>
          : <button className="btn ghost big" onClick={async () => ctx.toast((await copyText(value)) ? 'Copied' : 'Copy blocked by browser')}>Copy</button>}
        <button className="btn ghost big" onClick={() => { setValue(null); setAttempt((n) => n + 1) }}>Scan again</button>
      </div>
    </div>}
  </>
}

type Page = { bytes: Uint8Array; w: number; h: number; blob: Blob; url: string }

function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = video.videoWidth
  c.height = video.videoHeight
  const g = c.getContext('2d')
  if (!g) return Promise.reject(new Error('no canvas'))
  g.drawImage(video, 0, 0)
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('bad frame'))), 'image/jpeg', 0.92))
}

function DocGuide() {
  const corner = (style: CSSProperties) => <i style={style} />
  return <div className="pp-guide" aria-hidden="true">
    {corner({ top: -2, left: -2, borderRight: 0, borderBottom: 0, borderTopLeftRadius: 12 })}
    {corner({ top: -2, right: -2, borderLeft: 0, borderBottom: 0, borderTopRightRadius: 12 })}
    {corner({ bottom: -2, left: -2, borderRight: 0, borderTop: 0, borderBottomLeftRadius: 12 })}
    {corner({ bottom: -2, right: -2, borderLeft: 0, borderTop: 0, borderBottomRightRadius: 12 })}
  </div>
}

function DocScan({ ctx, pages, setPages }: { ctx: CoreCtx; pages: Page[]; setPages: Dispatch<SetStateAction<Page[]>> }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const clear = () => setPages((ps) => { ps.forEach((p) => URL.revokeObjectURL(p.url)); return [] })
  const pushPage = (j: { bytes: Uint8Array; w: number; h: number; blob: Blob }) => {
    const url = URL.createObjectURL(j.blob)
    setPages((p) => [...p, { ...j, url }])
  }
  const add = async (list: FileList) => {
    setBusy(true)
    try {
      for (const f of Array.from(list)) {
        try { pushPage(await imageFileToJpeg(f)) } catch { ctx.toast('Could not read that photo') }
      }
    } finally { setBusy(false) }
  }
  const shoot = async () => {
    const v = videoRef.current
    if (!v?.videoWidth || busy) return
    setBusy(true)
    try { pushPage(await imageFileToJpeg(await grabFrame(v))) } catch { ctx.toast('Could not read that photo') } finally { setBusy(false) }
  }
  useEffect(() => {
    let dead = false
    let stream: MediaStream | null = null
    setErr('')
    setPreview(false)
    ;(async () => {
      try {
        stream = await openCapture('camera', 'environment')
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return }
        const video = videoRef.current
        if (video) { video.srcObject = stream; await video.play().catch(() => {}) }
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return }
        setPreview(true)
      } catch (e) { if (!dead) setErr(mediaError('camera', e)) }
    })()
    return () => {
      dead = true
      stream?.getTracks().forEach((t) => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [attempt])
  const sendPdf = async () => {
    if (!pages.length || busy) return
    setBusy(true)
    try {
      const pdf = await jpegsToPdf(pages)
      sendFiles(ctx, [new File([pdf], `Scan ${stamp()}.pdf`, { type: 'application/pdf' })])
      clear()
      ctx.toast('PDF sent')
    } catch { ctx.toast('Could not build the PDF') } finally { setBusy(false) }
  }
  const sendImgs = () => {
    if (!pages.length || busy) return
    const name = stamp()
    sendFiles(ctx, pages.map((p, i) => new File([p.blob], `Scan ${name}-${i + 1}.jpg`, { type: 'image/jpeg' })))
    clear()
    ctx.toast('Images sent')
  }
  const show = preview && !err
  return <>
    <input ref={inputRef} data-testid="scan-input" type="file" accept="image/*" capture="environment" hidden onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = '' }} />
    <div className={'pp-shot' + (show ? '' : ' off')}>
      <video ref={videoRef} autoPlay muted playsInline data-testid="doc-preview" />
      {show && <DocGuide />}
    </div>
    {err && <Blocked text={err} onRetry={() => setAttempt((n) => n + 1)} />}
    {err && <button className="btn ghost big" onClick={() => inputRef.current?.click()}>Choose a photo</button>}
    {!err && !preview && <div className="card pad" style={{ textAlign: 'center', padding: '42px 20px' }}><span className="spin" /><p className="mut" style={{ marginTop: 14 }}>Turning the camera on…</p></div>}
    {show && <button className="pp-shutter" aria-label="Take photo" disabled={busy} onClick={() => void shoot()}><span /></button>}
    {busy && <p className="mut small" style={{ textAlign: 'center' }}>Processing…</p>}
    {pages.length > 0 && <>
      <div className="h-row"><h3 style={{ margin: 0 }}>Pages</h3><span className="tag">{pages.length}</span></div>
      <div className="pp-strip">{pages.map((p, i) => <div key={p.url} className="scan-pg"><img src={p.url} alt={`Page ${i + 1}`} /><span>{i + 1}</span><button aria-label="Remove" onClick={() => setPages((xs) => xs.filter((x) => { if (x !== p) return true; URL.revokeObjectURL(p.url); return false }))}><Icon n="x" /></button></div>)}</div>
      <button className="btn big" data-testid="scan-send-pdf" disabled={busy} onClick={() => void sendPdf()}>Send as PDF</button>
      <button className="btn ghost big" disabled={busy} onClick={sendImgs}>Send images</button>
    </>}
  </>
}

function ScanPage({ ctx }: { ctx: CoreCtx }) {
  const [mode, setMode] = useState<'code' | 'doc'>('doc')
  const [pages, setPages] = useState<Page[]>([])
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  useEffect(() => () => { pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)) }, [])
  return <div className="pg">
    <Look />
    <div className="seg" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <button className={mode === 'doc' ? 'on' : ''} onClick={() => setMode('doc')}>Document</button>
      <button className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>Code</button>
    </div>
    {mode === 'code' ? <CodeScan ctx={ctx} /> : <DocScan ctx={ctx} pages={pages} setPages={setPages} />}
  </div>
}

registerFeature({
  id: 'camera', title: 'Camera', icon: 'camera', order: 50, laptopColumn: 'right',
  PhonePage: ({ ctx }) => <Capture ctx={ctx} kind="camera" />,
  LaptopPanel: CameraPanel,
  init: () => {
    const offC = onCall('camera', (call) => acceptCall('camera', call))
    const offM = onMessage('cam:stop', onStop)
    return () => { offC(); offM(); dropIncoming('camera') }
  },
})

registerFeature({
  id: 'mic', title: 'Mic', icon: 'mic', order: 55, laptopColumn: 'right',
  PhonePage: ({ ctx }) => <Capture ctx={ctx} kind="mic" />,
  LaptopPanel: MicPanel,
  init: () => {
    const off = onCall('mic', (call) => acceptCall('mic', call))
    return () => { off(); dropIncoming('mic') }
  },
})

registerFeature({
  id: 'scan', title: 'Scan', icon: 'scan', order: 60,
  PhonePage: ScanPage,
})
