import React, { useEffect, useReducer, useRef } from 'react'
import { Icon } from './icons'
import { copyText, linkify } from './util'
import type { CoreCtx } from './bus'
import type { Link } from './link'

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
  return <span className="pill warn" data-testid="status">{s === 'reconnecting' ? 'Reconnecting…' : s === 'waiting' ? 'Waiting for phone…' : s === 'connecting' ? 'Connecting…' : 'Not connected'}</span>
}

export function ConnRelayNote({ link }: { link: Link }) {
  if (link.connViaRelay !== true) return null
  return <span className="mut sm conn-relay-note" data-testid="conn-relay">Connected via relay</span>
}

export function StatusRow({ link }: { link: Link }) {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => link.subscribe(bump), [link])
  return (
    <div className="row-g status-row">
      <StatusPill link={link} />
      <ConnRelayNote link={link} />
    </div>
  )
}
