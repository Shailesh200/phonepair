import React from 'react'
import { CoreCtx, getFeatures } from './core/bus'
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
    <header className="nav">
      <Logo />
      <nav><a href="#how">How it works</a></nav>
    </header>
    <div className="landing-copy">
      <h1>Your phone.<br />On your laptop.</h1>
      <p className="lead">Scan the code. Send files, text, and a remote — right in the browser.</p>
    </div>
    <div className="stage-row" id="how">
      <StudioStage />
      <QrCard
        link={ctx.link}
        phase={cardPhase}
        onNewCode={() => ctx.link.rollHostCode()}
        onTryAgain={() => ctx.link.restartHost()}
        onToast={ctx.toast}
      />
    </div>
    <footer className="landing-foot">
      Works in any browser<span className="sep">·</span><span id="privacy">Direct and encrypted</span><span className="sep">·</span>Free
    </footer>
  </div>
}

function StudioStage() {
  return <div className="art" aria-hidden="true">
    <div className="art-laptop">
      <div className="art-lid">
        <div className="art-cam" />
        <div className="art-screen">
          <div className="art-os-bar"><span className="art-os-dot" /><span className="art-os-dot" /><span className="art-os-dot" /></div>
          <div className="art-os-win" /><div className="art-os-side" />
        </div>
      </div>
      <div className="art-base" />
    </div>
    <div className="art-fly">
      <div className="art-trail" />
      <div className="art-file">
        <div className="art-file-img" />
        <div className="art-file-cap">IMG_2041.jpg</div>
      </div>
    </div>
    <div className="art-phone">
      <div className="art-island" />
      <div className="art-ph-screen" />
    </div>
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
