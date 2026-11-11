// Feature 3: files + screenshots both ways. Messages: file:start, file:chunk, file:end
import React, { useEffect, useRef, useState } from 'react'
import { createStore, registerFeature, onMessage, CoreCtx } from '../../core/bus'
import { Icon } from '../../core/icons'
import { download, fmtSize, uid } from '../../core/util'

export type FileItem = { id: string; dir: 'in' | 'out'; name: string; size: number; mime: string; url?: string; progress: number; ts: number }
export const files = createStore<FileItem[]>([])
const patch = (id: string, p: Partial<FileItem>) => files.set((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))
const CHUNK = 64 * 1024
const PREVIEW = 3
let queue: Promise<unknown> = Promise.resolve()

function isImage(it: FileItem) {
  return it.mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif)$/i.test(it.name)
}

async function sendOne(ctx: CoreCtx, f: Blob, name: string, id: string) {
  const c = ctx.link.conn
  if (!c?.open) throw new Error('Not connected')
  ctx.send({ t: 'file:start', id, name, size: f.size, mime: f.type || 'application/octet-stream' })
  const dc: RTCDataChannel | undefined = (c as any).dataChannel
  let last = 0
  for (let off = 0, seq = 0; off < f.size; off += CHUNK, seq++) {
    while ((dc && dc.bufferedAmount > 2 * 1024 * 1024) || ((c as any).bufferSize ?? 0) > 64) {
      await new Promise((r) => setTimeout(r, 20))
      if (!c.open) throw new Error('Connection lost')
    }
    c.send({ t: 'file:chunk', id, seq, data: new Uint8Array(await f.slice(off, off + CHUNK).arrayBuffer()) })
    const p = Math.min(1, (off + CHUNK) / f.size); if (p - last > 0.02) { last = p; patch(id, { progress: p }) }
  }
  ctx.send({ t: 'file:end', id })
  patch(id, { progress: 1 })
}

export function sendFiles(ctx: CoreCtx, list: File[] | FileList, rename?: (f: File) => string) {
  Array.from(list).forEach((f) => {
    const id = uid(); const name = rename ? rename(f) : f.name
    files.set((xs) => [{ id, dir: 'out', name, size: f.size, mime: f.type, url: URL.createObjectURL(f), progress: 0, ts: Date.now() }, ...xs])
    queue = queue.then(() => sendOne(ctx, f, name, id).catch((e) => { patch(id, { progress: -1 }); ctx.toast(`Could not send ${name}: ${e?.message || e}`) }))
  })
}

function FileGlyph({ it }: { it: FileItem }) {
  const [broken, setBroken] = useState(false)
  const img = isImage(it)
  // Received photos and screenshots preview in the row; everything else uses a file-type icon.
  if (img && it.dir === 'in' && it.url && !broken) return <img className="thumb" src={it.url} alt="" onError={() => setBroken(true)} />
  return <i className="ri"><Icon n={img ? 'image' : 'file'} /></i>
}

function Row({ it }: { it: FileItem }) {
  const failed = it.progress < 0
  const done = it.progress >= 1
  const busy = !failed && it.progress < 1
  return <div className="row" data-testid={`item-${it.dir}-file`}>
    <FileGlyph it={it} />
    <div className="grow">
      <b className="fname">{it.name}</b>
      <small>{fmtSize(it.size)}</small>
      {busy && <div className="bar" data-testid="file-progress"><span style={{ width: `${Math.max(0, Math.round(it.progress * 100))}%` }} /></div>}
    </div>
    {failed && <span className="tag bad">Failed</span>}
    {done && <button type="button" className={'tag' + (it.dir === 'in' ? ' ok' : '')} data-testid="download" data-name={it.name} onClick={() => { if (it.url) download(it.url, it.name) }}>{it.dir === 'in' ? 'Received' : 'Sent'}</button>}
  </div>
}

function LaptopPanel({ ctx }: { ctx: CoreCtx }) {
  const [drag, setDrag] = useState(false)
  const [all, setAll] = useState(false)
  const list = files.use()
  const shown = all ? list : list.slice(0, PREVIEW)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return
      const fl = Array.from(e.clipboardData?.files || [])
      if (fl.length) sendFiles(ctx, fl, (f) => (f.name === 'image.png' ? `Screenshot ${new Date().toLocaleTimeString()}.png` : f.name))
    }
    window.addEventListener('paste', onPaste); return () => window.removeEventListener('paste', onPaste)
  }, [ctx])
  return <>
    <label className={'drop card' + (drag ? ' on' : '')} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); sendFiles(ctx, e.dataTransfer.files) }}>
      <input data-testid="file-input" type="file" multiple hidden onChange={(e) => { if (e.target.files) sendFiles(ctx, e.target.files); e.target.value = '' }} />
      <span className="drop-ic"><Icon n="share" /></span>
      <b>Drop files here to send to your phone</b>
      <small>or <u>browse</u>: photos, PDFs, anything. Paste a screenshot with Ctrl/⌘+V.</small>
    </label>
    <div className="card pad">
      <h3 className="h-row"><span>Recent transfers</span><button type="button" className="see-all" data-testid="see-all" onClick={() => setAll((v) => !v)}>{all && list.length > PREVIEW ? 'Show less' : 'See all'}</button></h3>
      {list.length === 0 ? <p className="mut small">Nothing yet. Files you send or receive show up here.</p> : <div className="list">{shown.map((it) => <Row key={it.id} it={it} />)}</div>}
    </div>
  </>
}

function JustReceived({ it }: { it: FileItem }) {
  const [broken, setBroken] = useState(false)
  const img = isImage(it) && !!it.url && !broken
  return <div className="last card" data-testid="just-received">
    <i style={img ? { overflow: 'hidden' } : undefined}>
      {img ? <img src={it.url} alt="" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} /> : <Icon n={isImage(it) ? 'image' : 'file'} />}
    </i>
    <div><small>Just received</small><b className="fname">{it.name}</b></div>
    <button type="button" className="see-all" data-testid="just-received-open" onClick={() => { if (it.url) download(it.url, it.name) }}>Open</button>
  </div>
}

function PhonePage({ ctx }: { ctx: CoreCtx }) {
  const ref = useRef<HTMLInputElement>(null)
  const list = files.use()
  const lastIn = list.find((it) => it.dir === 'in' && it.progress >= 1 && it.url)
  return <>
    {lastIn && <JustReceived it={lastIn} />}
    <div className="pg">
      <input ref={ref} data-testid="phone-file-input" type="file" multiple hidden onChange={(e) => { if (e.target.files) sendFiles(ctx, e.target.files); e.target.value = '' }} />
      <button className="bigpick card" onClick={() => ref.current?.click()}><span className="drop-ic"><Icon n="upload" /></span><b>Choose photos or files</b><small>Photos, screenshots, or any file — they go straight to your laptop</small></button>
      <h3 className="sec">Transfers</h3>
      {list.length ? <div className="list">{list.map((it) => <Row key={it.id} it={it} />)}</div> : <p className="mut small">Files from your laptop show up here too.</p>}
    </div>
  </>
}

const incoming: Record<string, { name: string; size: number; mime: string; chunks: Uint8Array[]; got: number }> = {}
registerFeature({
  id: 'files', title: 'Send file', icon: 'upload', order: 10, laptopColumn: 'left', LaptopPanel, PhonePage,
  init: (ctx) => {
    const a = onMessage('file:start', (m) => {
      incoming[m.id] = { name: m.name, size: m.size, mime: m.mime, chunks: [], got: 0 }
      files.set((xs) => [{ id: m.id, dir: 'in', name: m.name, size: m.size, mime: m.mime, progress: 0, ts: Date.now() }, ...xs])
    })
    const b = onMessage('file:chunk', (m) => {
      const f = incoming[m.id]; if (!f) return
      const d: Uint8Array = m.data instanceof Uint8Array ? m.data : new Uint8Array(m.data)
      const before = f.got; f.chunks[m.seq] = d; f.got += d.byteLength
      if (f.size && Math.floor((f.got / f.size) * 50) !== Math.floor((before / f.size) * 50)) patch(m.id, { progress: f.got / f.size })
    })
    const c = onMessage('file:end', (m) => {
      const f = incoming[m.id]; if (!f) return
      const blob = new Blob(f.chunks as BlobPart[], { type: f.mime }); delete incoming[m.id]
      patch(m.id, { progress: 1, url: URL.createObjectURL(blob), size: blob.size })
      ctx.toast(`Received ${f.name}`)
    })
    return () => { a(); b(); c() }
  },
})
