import React, { useEffect, useState } from 'react'
import { CoreCtx, getFeatures } from './core/bus'
import { Icon } from './core/icons'
import { Logo } from './core/ui'
import { CodeEntry } from './features/pairing/CodeEntry'
import { PhoneConnecting } from './features/pairing/PhoneConnecting'
import { joinPath } from './features/pairing/relay'

export function Phone({ ctx, page, setPage, onLeave }: { ctx: CoreCtx; page: string; setPage: (p: string) => void; onLeave: () => void }) {
  const s = ctx.link.status
  const [dcIn, setDcIn] = useState<number | null>(null)

  useEffect(() => { const h = () => setPage(history.state?.p || 'home'); window.addEventListener('popstate', h); return () => window.removeEventListener('popstate', h) }, [setPage])
  const back = () => { if (history.state?.p) history.back(); else setPage('home') }

  useEffect(() => {
    if (dcIn === null) return
    if (dcIn <= 0) {
      ctx.link.disconnect()
      setDcIn(null)
      ctx.toast('Disconnected from laptop')
      return
    }
    const id = window.setTimeout(() => setDcIn(dcIn - 1), 1000)
    return () => clearTimeout(id)
  }, [dcIn, ctx])

  if (s === 'error') {
    return (
      <CodeEntry
        error={ctx.link.error}
        onClearError={() => {}}
        onCode={(c) => { location.assign(joinPath(c)) }}
      />
    )
  }
  if (s === 'closed') {
    return (
      <div className="phone-wrap">
        <div className="phone-page center">
          <Logo />
          <h2>Disconnected</h2>
          <p className="mut">You can pair again any time.</p>
          <button className="btn big" onClick={() => location.reload()}>Reconnect</button>
          <button type="button" className="linkbtn" onClick={onLeave}>Pair with a different laptop</button>
        </div>
      </div>
    )
  }
  if (s !== 'connected' && s !== 'reconnecting') {
    return (
      <PhoneConnecting
        link={ctx.link}
        onLeave={onLeave}
        onRetry={() => ctx.link.redialGuest()}
      />
    )
  }

  const feats = getFeatures().filter((f) => f.PhonePage)
  const cur = feats.find((f) => f.id === page)
  return (
    <div className="phone-wrap">
      <div className="phone-page">
        {!cur ? (
          <div className="top">
            <Logo small />
            <button
              className="iconbtn"
              aria-label="Disconnect"
              data-testid="phone-disconnect"
              onClick={() => setDcIn(5)}
            >
              <Icon n="x" />
            </button>
          </div>
        ) : (
          <div className="top">
            <button className="iconbtn" aria-label="Back" data-testid="back" onClick={back}><Icon n="back" /></button>
            <b className="ttl">{cur.title}</b>
            <span className={'pill sm' + (s === 'connected' ? '' : ' warn')}>{s === 'connected' ? ctx.link.remoteName || 'Laptop' : '…'}</span>
          </div>
        )}
        {dcIn !== null && dcIn > 0 && (
          <UndoBar seconds={dcIn} onUndo={() => setDcIn(null)} />
        )}
        {s === 'reconnecting' && <div className="banner warn">Reconnecting to your laptop…</div>}
        {!cur ? (
          <>
            <div className="conn card">
              <span className="lap"><Icon n="screen" /></span>
              <div className="conn-txt">
                <small>Connected to</small>
                <b data-testid="status">{ctx.link.remoteName || 'Laptop'}</b>
              </div>
              <span className={'dot' + (s === 'connected' ? '' : ' off')} aria-hidden />
            </div>
            <div className="tiles">
              {feats.map((f, k) => (
                <button
                  key={f.id}
                  data-testid={`tile-${f.id}`}
                  className={'t card' + (k === 0 ? ' hi' : '')}
                  onClick={() => ctx.openPage(f.id)}
                >
                  <i><Icon n={f.icon} /></i>
                  <b>{f.title}</b>
                </button>
              ))}
            </div>
          </>
        ) : (() => { const P = cur.PhonePage!; return <P ctx={ctx} /> })()}
      </div>
    </div>
  )
}

function UndoBar({ seconds, onUndo }: { seconds: number; onUndo: () => void }) {
  return (
    <div className="undo-bar">
      <span>Disconnected</span>
      <button type="button" className="linkbtn" onClick={onUndo}>Undo ({seconds}s)</button>
    </div>
  )
}

export function PhoneEntry(props: { onCode: (c: string) => void; onHost?: () => void; error?: string }) {
  return <CodeEntry {...props} />
}
