import React, { useEffect, useReducer, useRef, useState } from 'react'
import { Icon } from './icons'
import { copyText, linkify } from './util'
import type { CoreCtx } from './bus'
import type { Link } from './link'
import { laptopStatusLabel } from '../features/pairing/hostSignalReconnect'

export function Logo({ small }: { small?: boolean }) {
  return <a className={'logo' + (small ? ' sm' : '')} href="/">PhonePair<i>.</i></a>
}
export function Linkified({ text }: { text: string }) {
  return <>{linkify(text).map((p, i) => typeof p === 'string' ? <React.Fragment key={i}>{p}</React.Fragment> : <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.href}</a>)}</>
}
export function CopyBtn({ text, ctx, label }: { text: string; ctx: CoreCtx; label?: string }) {
  return <button className="iconbtn sm" title="Copy" aria-label="Copy" onClick={async () => ctx.toast((await copyText(text)) ? 'Copied' : 'Copy blocked by browser')}><Icon n="copy" />{label && <span>{label}</span>}</button>
}
export function Video({ stream, muted = true, className, testid }: { stream: MediaStream; muted?: boolean; className?: string; testid?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; ref.current.play().catch(() => {}) } }, [stream])
  return <video data-testid={testid} ref={ref} className={className} autoPlay playsInline muted={muted} />
}
export function StatusPill({ link }: { link: Link }) {
  const s = link.status
  if (s === 'connected') return <span className="pill" data-testid="status">Connected to {link.remoteName || 'device'}</span>
  return <span className="pill warn" data-testid="status">{laptopStatusLabel(s, link.role === 'host' && link.hadGuest)}</span>
}

export function ConnRelayNote({ link }: { link: Link }) {
  if (link.connViaRelay !== true) return null
  return <span className="mut sm conn-relay-note" data-testid="conn-relay">Connected via relay</span>
}

/** Renders the relay footnote when the active data path uses TURN (testid conn-relay). */
export function connRelayNoteVisible(connViaRelay: boolean | null): boolean {
  return connViaRelay === true
}

export function MoreMenu({ label, testId, items }: {
  label: string
  testId: string
  items: { id: string; label: string; onClick: () => void }[]
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return <div className="pp-more" ref={root}>
    <button type="button" className="iconbtn" data-testid={testId} aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
    </button>
    {open ? <div className="pp-more-menu" role="menu">
      {items.map((item) => (
        <button key={item.id} type="button" role="menuitem" data-testid={`${testId}-${item.id}`} onClick={() => { setOpen(false); item.onClick() }}>{item.label}</button>
      ))}
    </div> : null}
  </div>
}
