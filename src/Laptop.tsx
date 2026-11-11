import React from 'react'
import { CoreCtx, getFeatures } from './core/bus'
import { Icon } from './core/icons'
import { Logo, StatusPill } from './core/ui'
import { QrCard } from './features/pairing/QrCard'
import { useHostPairFlow } from './features/pairing/useHostPairFlow'

export function Laptop({ ctx }: { ctx: CoreCtx }) {
  const flow = useHostPairFlow(ctx.link)
  const feats = getFeatures()
  const waitingPhone = ctx.link.hadGuest && ctx.link.status === 'reconnecting'

  return <div className="laptop">
    {flow.showDashboard ? <Dashboard ctx={ctx} waitingPhone={waitingPhone} /> : <Landing ctx={ctx} cardPhase={flow.cardPhase} />}
    {flow.showDashboard && feats.map((f) => f.LaptopOverlay && <f.LaptopOverlay key={f.id} ctx={ctx} />)}
  </div>
}

function Landing({ ctx, cardPhase }: { ctx: CoreCtx; cardPhase: ReturnType<typeof useHostPairFlow>['cardPhase'] }) {
  return <div className="landing">
    <header className="nav"><Logo /><nav><a href="#how">How it works</a><a href="#privacy">Privacy</a><span className="pill soft">No app. No sign-up.</span></nav></header>
    <main className="hero">
      <section className="hero-l">
        <h1>Your phone and laptop,<br /><span>paired in one scan.</span></h1>
        <p className="lead">Send files, share clipboard, use your phone as a remote. Right in the browser.</p>
        <ol className="steps" id="how">
          <li><b>1</b><div><strong>Open camera</strong><small>on your phone</small></div></li>
          <li><b>2</b><div><strong>Scan</strong><small>the code here</small></div></li>
          <li><b>3</b><div><strong>Done</strong><small>you're paired</small></div></li>
        </ol>
        <div className="chips landing-chips">{[['file', 'Files'], ['clip', 'Clipboard'], ['pointer', 'Remote'], ['screen', 'Screen view']].map(([i, t]) => <span key={t} className="chip static"><Icon n={i} />{t}</span>)}</div>
      </section>
      <QrCard
        link={ctx.link}
        phase={cardPhase}
        onNewCode={() => ctx.link.rollHostCode()}
        onTryAgain={() => ctx.link.restartHost()}
        onToast={ctx.toast}
      />
    </main>
  </div>
}

function Dashboard({ ctx, waitingPhone }: { ctx: CoreCtx; waitingPhone: boolean }) {
  const feats = getFeatures().filter((f) => f.LaptopPanel)
  const col = (c: 'left' | 'right') => feats.filter((f) => (f.laptopColumn ?? 'right') === c).map((f) => { const P = f.LaptopPanel!; return <P key={f.id} ctx={ctx} /> })
  return <div className="dash">
    <header className="nav"><Logo /><div className="row-g"><StatusPill link={ctx.link} /><button className="btn ghost" data-testid="disconnect" onClick={() => ctx.link.disconnect()}>Disconnect</button></div></header>
    {waitingPhone && <div className="banner warn dash-wait">Phone disconnected, waiting to reconnect</div>}
    <div className="grid">
      <div className="col">{col('left')}</div>
      <div className="col">{col('right')}</div>
    </div>
  </div>
}
