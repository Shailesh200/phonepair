import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { CoreCtx, getFeatures } from './core/bus'
import { Icon } from './core/icons'
import { Logo, StatusPill } from './core/ui'

export function Laptop({ ctx }: { ctx: CoreCtx }) {
  const connected = ctx.link.status === 'connected'
  const feats = getFeatures()
  return <div className="laptop">
    {connected ? <Dashboard ctx={ctx} /> : <Landing ctx={ctx} />}
    {connected && feats.map((f) => f.LaptopOverlay && <f.LaptopOverlay key={f.id} ctx={ctx} />)}
  </div>
}

function Landing({ ctx }: { ctx: CoreCtx }) {
  const code = ctx.link.code
  const url = `${location.origin}/j/${code}`
  const [qr, setQr] = useState('')
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: 520, color: { dark: '#0F172A', light: '#FFFFFF' }, errorCorrectionLevel: 'M' }).then(setQr) }, [url])
  const s = ctx.link.status
  return <div className="landing">
    <header className="nav"><Logo /><nav><a href="#how">How it works</a><a href="#privacy">Privacy</a><span className="pill soft">No app. No sign-up.</span></nav></header>
    <main className="hero">
      <section className="hero-l">
        <h1>Your phone and laptop,<br /><span>paired in one scan.</span></h1>
        <p className="lead">Send files, share clipboard, use your phone as a remote, webcam or scanner. Right in the browser.</p>
        <ol className="steps" id="how">
          <li><b>1</b><div><strong>Open camera</strong><small>on your phone</small></div></li>
          <li><b>2</b><div><strong>Scan</strong><small>the code here</small></div></li>
          <li><b>3</b><div><strong>Done</strong><small>you're paired</small></div></li>
        </ol>
        <div className="chips">{[['file', 'Files'], ['clip', 'Clipboard'], ['pointer', 'Remote'], ['camera', 'Webcam'], ['scan', 'Scanner'], ['screen', 'Screen view']].map(([i, t]) => <span key={t} className="chip static"><Icon n={i} />{t}</span>)}</div>
      </section>
      <section className="qr-card card">
        <div className="qr">{qr ? <img src={qr} alt={`QR code for ${url}`} data-testid="qr" /> : <div className="qr-ph" />}<span className="qr-mark"><span className="mark"><span /><span /></span></span></div>
        <p className="wait"><span className="spin" />{s === 'waiting' ? 'Waiting for your phone…' : s === 'starting' ? 'Getting ready…' : s === 'error' ? ctx.link.error : 'Connecting…'}</p>
        <p className="mut small">or type this code at <b>{location.host}</b> on your phone</p>
        <div className="code" data-testid="pair-code" aria-label={`Pairing code ${code}`}>{code.split('').map((c, i) => <span key={i}>{c}</span>)}</div>
        <p className="mut small lock" id="privacy"><Icon n="lock" /> Direct device-to-device, end-to-end encrypted</p>
      </section>
    </main>
  </div>
}

function Dashboard({ ctx }: { ctx: CoreCtx }) {
  const feats = getFeatures().filter((f) => f.LaptopPanel)
  const col = (c: 'left' | 'right') => feats.filter((f) => (f.laptopColumn ?? 'right') === c).map((f) => { const P = f.LaptopPanel!; return <P key={f.id} ctx={ctx} /> })
  return <div className="dash">
    <header className="nav"><Logo /><div className="row-g"><StatusPill link={ctx.link} /><button className="btn ghost" data-testid="disconnect" onClick={() => ctx.link.disconnect()}>Disconnect</button></div></header>
    <div className="grid">
      <div className="col">{col('left')}</div>
      <div className="col">{col('right')}</div>
    </div>
  </div>
}
