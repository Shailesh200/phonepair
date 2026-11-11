// Feature: live clipboard with a shared history. Messages: clip:set
import React, { useEffect, useState } from 'react'
import { registerFeature, onMessage, CoreCtx } from '../../core/bus'
import { Icon } from '../../core/icons'
import { Linkified } from '../../core/ui'
import {
  CLIP_READ_BLOCKED, Device, Entry, applyClipMessage, clearClipTimer, clip, clipMeta, commitClip, copyClip, editClip, history, onComposerPaste, readSystemClipboard,
} from './logic'

export {
  CLIP_READ_BLOCKED, clip, history, applyClipMessage, commitClip, copyClip, editClip, readSystemClipboard,
} from './logic'

function readUnsupported() {
  return typeof navigator === 'undefined' || typeof navigator.clipboard?.readText !== 'function'
}

export async function copyEntry(text: string, toast: (msg: string) => void) {
  toast((await copyClip(text)) ? 'Copied' : 'Copy blocked by browser')
}

function DeviceIcon({ device }: { device: Device }) {
  if (device === 'phone') {
    return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
  }
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M2 20h20" /></svg>
}

export function HistoryList({ entries, now, onCopy }: { entries: Entry[]; now: number; onCopy: (text: string) => void }) {
  if (!entries.length) return <p className="mut small" data-testid="clip-empty">Nothing copied yet.</p>
  return <div className="list hist" data-testid="clip-history">{entries.map((e) => <div className="row" key={e.id} data-testid="clip-row">
    <i className="ri" data-testid={`device-${e.device}`} title={e.device === 'phone' ? 'Phone' : 'Laptop'}><DeviceIcon device={e.device} /></i>
    <div className="grow">
      <small className="mut" data-testid="clip-meta">{clipMeta(e.text, e.ts, now)}</small>
      <div className="txt one" data-testid="clip-text" title={e.text}><Linkified text={e.text} /></div>
    </div>
    <button type="button" className="iconbtn sm" title="Copy" aria-label="Copy" data-testid="clip-copy" onClick={() => onCopy(e.text)}><Icon n="copy" /></button>
  </div>)}</div>
}

export function ClipboardView({ variant, value, entries, now, fallback, message, onChange, onPasteText, onSend, onPasteClick, onCopy }: {
  variant: 'laptop' | 'phone'
  value: string
  entries: Entry[]
  now: number
  fallback: boolean
  message: string
  onChange: (text: string) => void
  onPasteText: (text: string) => void
  onSend: () => void
  onPasteClick: () => void
  onCopy: (text: string) => void
}) {
  const box = <>
    {fallback && message ? <p className="err" data-testid="clip-fallback" role="status">{message}</p> : null}
    <textarea
      data-testid={variant === 'phone' ? 'phone-clip-box' : 'clip-box'}
      className="clip"
      rows={variant === 'phone' ? 4 : 3}
      value={value}
      placeholder={fallback ? 'Paste here, then press Send' : variant === 'phone' ? 'Type or paste here and it appears on your laptop instantly.' : 'Type or paste here and it appears on your phone instantly.'}
      onChange={(e) => onChange(e.target.value)}
      onPaste={(e) => onComposerPaste(e, value, onPasteText)}
    />
    <div className="row-g">
      <button type="button" className={'btn ghost' + (variant === 'laptop' ? ' sm' : '')} data-testid="clip-paste" onClick={onPasteClick}>{variant === 'laptop' ? 'Paste from clipboard' : 'Paste'}</button>
      {fallback && <button type="button" className="btn sm" data-testid="clip-send" onClick={onSend} disabled={!value.trim()}><Icon n="send" />Send</button>}
    </div>
    {variant === 'phone' && <h3 className="sec">History</h3>}
    <HistoryList entries={entries} now={now} onCopy={onCopy} />
  </>
  if (variant === 'phone') {
    return <div className="pg" data-testid="phone-clipboard">
      <p className="mut small">Anything typed or pasted here shows up on your laptop instantly, and the other way round.</p>
      {box}
    </div>
  }
  return <div className="card pad" data-testid="live-clipboard">
    <h3 className="h-row"><span><Icon n="clip" /> Live clipboard</span><span className="sync" data-testid="clip-sync">● Syncing</span></h3>
    {box}
  </div>
}

function useClipboardSync(ctx: CoreCtx) {
  const value = clip.use()
  const entries = history.use()
  const unsupported = readUnsupported()
  const [fallback, setFallback] = useState(unsupported)
  const [message, setMessage] = useState(unsupported ? CLIP_READ_BLOCKED : '')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(id)
  }, [])
  return {
    value, entries, now, fallback, message,
    onChange: (text: string) => editClip(ctx, text),
    onPasteText: (text: string) => commitClip(ctx, text),
    onSend: () => { if (!value.trim()) return; commitClip(ctx, value); ctx.toast('Sent') },
    onPasteClick: async () => {
      const result = await readSystemClipboard()
      if (result.ok) {
        setFallback(false); setMessage(''); commitClip(ctx, result.text)
        ctx.toast(result.text.trim() ? 'Clipboard synced' : 'Clipboard is empty')
      } else {
        setFallback(true); setMessage(result.message); ctx.toast(result.message)
      }
    },
    onCopy: (text: string) => { void copyEntry(text, ctx.toast) },
  }
}

function LaptopPanel({ ctx }: { ctx: CoreCtx }) {
  const state = useClipboardSync(ctx)
  return <ClipboardView variant="laptop" {...state} />
}

function PhonePage({ ctx }: { ctx: CoreCtx }) {
  const state = useClipboardSync(ctx)
  return <ClipboardView variant="phone" {...state} />
}

registerFeature({
  id: 'clipboard', title: 'Clipboard', icon: 'clip', order: 30, laptopColumn: 'right', LaptopPanel, PhonePage,
  init: () => {
    const off = onMessage('clip:set', (m, ctx) => applyClipMessage(m, ctx.role))
    return () => { off(); clearClipTimer() }
  },
})
