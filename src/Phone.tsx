import React, { useEffect, useState } from 'react'
import { CoreCtx, getFeatures } from './core/bus'
import { cleanCode } from './core/link'
import { Icon } from './core/icons'
import { Logo } from './core/ui'

export function Phone({ ctx, page, setPage, onLeave }: { ctx: CoreCtx; page: string; setPage: (p: string) => void; onLeave: () => void }) {
  const s = ctx.link.status
  useEffect(() => { const h = () => setPage(history.state?.p || 'home'); window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h) }, [setPage])
  const back = () => { if (history.state?.p) history.back(); else setPage('home') }

  if (s === 'error') return <PhoneEntry error={ctx.link.error} onCode={(c) => { location.href = `/j/${c}` }} />
  if (s === 'closed') return <div className="phone-wrap"><div className="phone-page center"><Logo /><h2>Disconnected</h2><p className="mut">You can pair again any time.</p><button className="btn big" onClick={() => location.reload()}>Reconnect</button><button className="linkbtn" onClick={onLeave}>Pair with a different laptop</button></div></div>
  if (s !== 'connected' && s !== 'reconnecting') return <div className="phone-wrap"><div className="phone-page center" data-testid="phone-connecting"><Logo /><span className="spin big" /><h2>Connecting to your laptop…</h2><p className="mut">Code <b className="mono">{ctx.link.code}</b>. Keep the PhonePair page open on your laptop.</p><button className="linkbtn" onClick={onLeave}>Use a different code</button></div></div>

  const feats = getFeatures().filter((f) => f.PhonePage)
  const cur = feats.find((f) => f.id === page)
  return <div className="phone-wrap"><div className="phone-page">
    {!cur ? <div className="top"><Logo small /><button className="iconbtn" aria-label="Disconnect" data-testid="phone-disconnect" onClick={() => { if (confirm('Disconnect from your laptop?')) ctx.link.disconnect() }}><Icon n="x" /></button></div>
      : <div className="top"><button className="iconbtn" aria-label="Back" data-testid="back" onClick={back}><Icon n="back" /></button><b className="ttl">{cur.title}</b><span className={'pill sm' + (s === 'connected' ? '' : ' warn')}>{s === 'connected' ? ctx.link.remoteName || 'Laptop' : '…'}</span></div>}
    {s === 'reconnecting' && <div className="banner warn">Reconnecting to your laptop…</div>}
    {!cur ? <>
      <div className="conn card"><span className="lap"><Icon n="screen" /></span><div><small>Connected to</small><b data-testid="status">{ctx.link.remoteName || 'Laptop'}</b></div><span className={'dot' + (s === 'connected' ? '' : ' off')} /></div>
      <div className="tiles">{feats.map((f, k) => <button key={f.id} data-testid={`tile-${f.id}`} className={'t card' + (k === 0 ? ' hi' : '')} onClick={() => ctx.openPage(f.id)}><i><Icon n={f.icon} /></i><b>{f.title}</b></button>)}</div>
    </> : (() => { const P = cur.PhonePage!; return <P ctx={ctx} /> })()}
  </div></div>
}

export function PhoneEntry({ onCode, onHost, error }: { onCode: (c: string) => void; onHost?: () => void; error?: string }) {
  const [v, setV] = useState('')
  const ok = v.length === 6
  return <div className="phone-wrap"><div className="phone-page entry">
    <div className="top"><Logo small /></div>
    <div className="entry-body">
      <h1>Pair with your laptop</h1>
      <p className="mut">Open <b>{location.host}</b> on your laptop, then scan the QR code with your camera, or type the 6-character code here.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onCode(v) }}>
        <input data-testid="code-input" className="code-input" value={v} onChange={(e) => setV(cleanCode(e.target.value))} placeholder="ABC123" autoCapitalize="characters" autoComplete="off" maxLength={6} />
        {error && <p className="err">{error}</p>}
        <button data-testid="code-join" className="btn big" disabled={!ok}>Connect</button>
      </form>
      {onHost && <button className="linkbtn" onClick={onHost}>Use this device as the laptop side instead</button>}
    </div>
  </div></div>
}
