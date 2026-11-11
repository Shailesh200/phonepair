import React, { useEffect, useState } from 'react'
import { CoreCtx, getFeatures } from './core/bus'
import { Icon } from './core/icons'
import type { Link } from './core/link'
import { Logo } from './core/ui'
import { ago, download, fmtSize } from './core/util'
import { files, type FileItem } from './features/files'
import { CodeEntry } from './features/pairing/CodeEntry'
import { PhoneConnecting } from './features/pairing/PhoneConnecting'
import { joinPath } from './features/pairing/relay'
import { phoneHostLabel } from './features/pairing/session'

const HINTS: Record<string, string> = {
  files: 'Photos, PDFs, anything',
  clipboard: 'Copy on one, paste on the other',
  remote: 'Trackpad, keyboard, and clicks',
  screen: 'See the laptop screen live',
  text: 'Type a note or paste a URL',
}

function useRtt(link: Link) {
  const [ms, setMs] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    const read = async () => {
      const pc = link.conn?.peerConnection
      if (!pc || link.status !== 'connected') {
        if (live) setMs(null)
        return
      }
      try {
        const stats = await pc.getStats()
        let found: number | null = null
        stats.forEach((report) => {
          if (report.type !== 'candidate-pair') return
          const pair = report as RTCIceCandidatePairStats
          if (pair.state === 'succeeded' && typeof pair.currentRoundTripTime === 'number') {
            found = Math.round(pair.currentRoundTripTime * 1000)
          }
        })
        if (live) setMs(found)
      } catch {
        if (live) setMs(null)
      }
    }
    void read()
    const id = window.setInterval(() => { void read() }, 2000)
    return () => { live = false; window.clearInterval(id) }
  }, [link, link.status, link.conn])
  return ms
}

function isImageFile(it: FileItem) {
  return it.mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif)$/i.test(it.name)
}

function HomeGlyph({ id, icon, hero }: { id: string; icon: string; hero?: boolean }) {
  if (hero || id === 'files') {
    return <svg className="send-icon" viewBox="0 0 32 32" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 20V5" /><path d="M10 11l6-6 6 6" /><path d="M6 18v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6" />
    </svg>
  }
  if (id === 'clipboard') {
    return <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="7" y="6.5" width="14" height="17" rx="2.2" stroke="#C6C6C2" strokeWidth="1.6" />
      <path d="M11 6.5V5.2A2.2 2.2 0 0 1 13.2 3h1.6A2.2 2.2 0 0 1 17 5.2v1.3" stroke="#C6F432" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  }
  if (id === 'remote') {
    return <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M6 4.5l16 11.6-7.8.7-3.7 7.8z" stroke="#C6C6C2" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14.2 16.8l3.6 6.8" stroke="#C6F432" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  }
  if (id === 'screen') {
    return <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="2.5" y="5.5" width="23" height="14" rx="2.2" stroke="#C6C6C2" strokeWidth="1.6" />
      <path d="M10 24h8" stroke="#C6F432" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 19.5V24" stroke="#C6F432" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  }
  return <Icon n={icon} />
}

function RecentFile({ it }: { it: FileItem }) {
  const [broken, setBroken] = useState(false)
  const img = isImageFile(it) && !!it.url && !broken
  const info = it.progress < 0 ? 'Failed' : it.progress < 1 ? `${Math.max(0, Math.round(it.progress * 100))}%` : `${fmtSize(it.size)} · ${ago(it.ts)}`
  return <button type="button" className="recent-file" disabled={!it.url} onClick={() => { if (it.url) download(it.url, it.name) }}>
    {img ? <img className="recent-thumb" src={it.url} alt="" onError={() => setBroken(true)} /> : <span className={'recent-thumb' + (isImageFile(it) ? ' photo' : ' doc')} aria-hidden="true"><span /></span>}
    <span className="recent-copy">
      <span className="recent-name">{it.name}</span>
      <span className="recent-info">{info}</span>
    </span>
  </button>
}

function RecentList() {
  const list = files.use().slice(0, 4)
  return <section className="recent" aria-label="Recent">
    <div className="recent-label">Recent</div>
    {list.length === 0
      ? <p className="recent-empty">Nothing yet. Files you send or receive show up here.</p>
      : <div className="recent-files">{list.map((it) => <RecentFile key={it.id} it={it} />)}</div>}
  </section>
}

export function Phone({ ctx, page, setPage, onLeave }: { ctx: CoreCtx; page: string; setPage: (p: string) => void; onLeave: () => void }) {
  const s = ctx.link.status
  const [dcIn, setDcIn] = useState<number | null>(null)
  const rtt = useRtt(ctx.link)

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
  const hostLabel = phoneHostLabel(ctx.link.remoteName, ctx.link.code)
  const hero = feats[0]
  const rest = feats.slice(1)
  const detail = s === 'connected'
    ? (rtt != null ? ` · ${rtt} ms · encrypted` : ' · encrypted')
    : ' · reconnecting'
  return (
    <div className="phone-wrap">
      <div className={'phone-page' + (cur ? '' : ' home')}>
        {!cur ? (
          <div className="home-strip">
            <div className="home-strip-l">
              <span className={'pulse' + (s === 'connected' ? '' : ' off')} aria-hidden="true"><span className="pulse-ring" /><span className="pulse-dot" /></span>
              <p className="strip-meta">
                <b data-testid="status">{hostLabel}</b>
                <span>{detail}</span>
              </p>
            </div>
            <button
              type="button"
              className="strip-disconnect"
              aria-label="Disconnect"
              data-testid="phone-disconnect"
              onClick={() => setDcIn(5)}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="top">
            <button className="iconbtn" aria-label="Back" data-testid="back" onClick={back}><Icon n="back" /></button>
            <b className="ttl">{cur.title}</b>
            <span className={'pill sm' + (s === 'connected' ? '' : ' warn')}>{s === 'connected' ? hostLabel : '…'}</span>
          </div>
        )}
        {dcIn !== null && dcIn > 0 && (
          <UndoBar seconds={dcIn} onUndo={() => setDcIn(null)} />
        )}
        {s === 'reconnecting' && <div className="banner warn">Reconnecting to your laptop…</div>}
        {!cur && hero ? (
          <>
            <button type="button" className="send-hero" data-testid={`tile-${hero.id}`} onClick={() => ctx.openPage(hero.id)}>
              <span className="send-body">
                <HomeGlyph id={hero.id} icon={hero.icon} hero />
                <span>
                  <span className="send-title">{hero.id === 'files' ? 'Send a file' : hero.title}</span>
                  {HINTS[hero.id] && <span className="send-sub">{HINTS[hero.id]}</span>}
                </span>
              </span>
            </button>
            <div className="home-grid">
              {rest.map((f) => (
                <button key={f.id} type="button" data-testid={`tile-${f.id}`} className="home-card" onClick={() => ctx.openPage(f.id)}>
                  <HomeGlyph id={f.id} icon={f.icon} />
                  <span className="home-card-title">{f.title}</span>
                  {HINTS[f.id] && <span className="home-card-hint">{HINTS[f.id]}</span>}
                </button>
              ))}
            </div>
            <RecentList />
          </>
        ) : cur ? (() => { const P = cur.PhonePage!; return <P ctx={ctx} /> })() : null}
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
