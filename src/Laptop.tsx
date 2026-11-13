import React, { useEffect, useState } from 'react'
import { CoreCtx, getFeatures } from './core/bus'
import { ConnRelayNote, Logo, MoreMenu, StatusPill } from './core/ui'
import { copyText } from './core/util'
import { QrCard } from './features/pairing/QrCard'
import { useHostPairFlow } from './features/pairing/useHostPairFlow'
import { hostShowsPairedView } from './features/pairing/hostSignalReconnect'
import { createReconnectEscape, endLaptopPair } from './features/pairing/reconnectEscape'
import { KeepAwakeCard, MoverHeaderBadge, stopMouseMover } from './features/remote'
import { RememberPrompt, SavedPhonesPanel } from './remember/ui'

function endPair(ctx: CoreCtx) {
  endLaptopPair(stopMouseMover, () => ctx.link.disconnect())
}

function useReconnectEscape(link: CoreCtx['link']) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const watch = createReconnectEscape({
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (id) => { window.clearTimeout(id) },
      onChange: setShown,
    })
    const off = link.subscribe(() => watch.onStatus(link.status))
    watch.onStatus(link.status)
    return () => { off(); watch.dispose() }
  }, [link])
  return shown
}

export function Laptop({ ctx }: { ctx: CoreCtx }) {
  const flow = useHostPairFlow(ctx.link)
  const feats = getFeatures()
  const waitingPhone = hostShowsPairedView(ctx.link.status, ctx.link.hadGuest) && ctx.link.status !== 'connected'
  const pairDifferent = useReconnectEscape(ctx.link)

  return <div className="laptop">
    {flow.showDashboard ? <Dashboard ctx={ctx} waitingPhone={waitingPhone} pairDifferent={pairDifferent} /> : <Landing ctx={ctx} cardPhase={flow.cardPhase} />}
    <RememberPrompt ctx={ctx} />
    {flow.showDashboard && feats.map((f) => f.LaptopOverlay && <f.LaptopOverlay key={f.id} ctx={ctx} />)}
  </div>
}

function Landing({ ctx, cardPhase }: { ctx: CoreCtx; cardPhase: ReturnType<typeof useHostPairFlow>['cardPhase'] }) {
  return <div className="landing">
    <div className="hero-fit">
      <header className="nav">
        <Logo />
        <nav><a href="#how">How it works</a></nav>
      </header>
      <div className="landing-copy">
        <h1>Your phone.<br />On your laptop.</h1>
        <p className="lead">Scan the code. Send files, a clipboard, or a remote, right in the browser.</p>
      </div>
      <RememberLandingExtras ctx={ctx} />
      <KeepAwakeCard />
      <div className="stage-row">
        <StudioStage />
        <QrCard
          link={ctx.link}
          phase={cardPhase}
          onNewCode={() => ctx.link.rollHostCode()}
          onTryAgain={() => ctx.link.restartHost()}
          onToast={ctx.toast}
        />
      </div>
    </div>
    <section className="how" id="how">
      <h2>How it works</h2>
      <ol className="steps">
        <li><span className="step-n">1</span><div><strong>Scan</strong><p>Point your camera at the code on this page.</p></div></li>
        <li><span className="step-n">2</span><div><strong>Pair</strong><p>The phone and laptop connect directly.</p></div></li>
        <li><span className="step-n">3</span><div><strong>Share</strong><p>Send files, a clipboard, or a remote.</p></div></li>
      </ol>
    </section>
    <div className="feat-row">
      <Feature title="Send files" hint="Photos, PDFs, anything" icon="files" />
      <Feature title="Clipboard" hint="Copy on one, paste on the other" icon="clip" />
      <Feature title="Remote" hint="Trackpad, keyboard, and clicks" icon="remote" />
      <Feature title="Screen view" hint="See the laptop screen live" icon="screen" />
    </div>
    <p className="trust" id="privacy">Direct peer-to-peer · Encrypted · No sign-up · Free</p>
  </div>
}

function RememberLandingExtras({ ctx }: { ctx: CoreCtx }) {
  return (
    <>
      <SavedPhonesPanel ctx={ctx} />
      {ctx.link.rememberListenOtherTab && (
        <p className="mut small remember-other-tab" data-testid="remember-other-tab">
          Saved phones are connected in another tab.
        </p>
      )}
    </>
  )
}

function Feature({ title, hint, icon }: { title: string; hint: string; icon: 'files' | 'clip' | 'remote' | 'screen' }) {
  return <div className="feat">
    <FeatIcon name={icon} />
    <b>{title}</b>
    <span>{hint}</span>
  </div>
}

function FeatIcon({ name }: { name: 'files' | 'clip' | 'remote' | 'screen' }) {
  if (name === 'files') {
    return <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M14 18V6" stroke="#5C564E" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 11l5-5 5 5" stroke="#2A1C16" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 16v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" stroke="#5C564E" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  }
  if (name === 'clip') {
    return <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect x="7" y="6.5" width="14" height="17" rx="2.2" stroke="#5C564E" strokeWidth="1.6" />
      <path d="M11 6.5V5.2A2.2 2.2 0 0 1 13.2 3h1.6A2.2 2.2 0 0 1 17 5.2v1.3" stroke="#2A1C16" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  }
  if (name === 'remote') {
    return <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <path d="M6 4.5l16 11.6-7.8.7-3.7 7.8z" stroke="#5C564E" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M14.2 16.8l3.6 6.8" stroke="#2A1C16" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  }
  return <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
    <rect x="2.5" y="5.5" width="23" height="14" rx="2.2" stroke="#5C564E" strokeWidth="1.6" />
    <path d="M10 24h8" stroke="#2A1C16" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M14 19.5V24" stroke="#2A1C16" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
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

function SessionMenu({ ctx, onDisconnect }: { ctx: CoreCtx; onDisconnect: () => void }) {
  const code = ctx.link.code
  const origin = typeof location === 'undefined' ? '' : location.origin
  const link = `${origin}/j/${code}`
  return <MoreMenu label="Session" testId="session-menu" items={[
    { id: 'code', label: `Code ${code}`, onClick: () => { void copyText(code).then((ok) => ctx.toast(ok ? 'Code copied' : code)) } },
    { id: 'link', label: 'Copy join link', onClick: () => { void copyText(link).then((ok) => ctx.toast(ok ? 'Join link copied' : link)) } },
    { id: 'saved', label: 'Saved phones', onClick: () => document.getElementById('saved-devices')?.scrollIntoView({ block: 'nearest' }) },
    { id: 'disconnect', label: 'Disconnect', onClick: onDisconnect },
  ]} />
}

function Dashboard({ ctx, waitingPhone, pairDifferent }: { ctx: CoreCtx; waitingPhone: boolean; pairDifferent: boolean }) {
  const feats = getFeatures().filter((f) => f.LaptopPanel)
  const files = feats.find((f) => f.id === 'files')
  const screen = feats.find((f) => f.id === 'screen')
  const rest = feats.filter((f) => f.id !== 'files' && f.id !== 'screen')
  const panel = (f: (typeof feats)[number]) => { const P = f.LaptopPanel!; return <P key={f.id} ctx={ctx} /> }
  const Files = files?.LaptopPanel as React.ComponentType<{ ctx: CoreCtx; children?: React.ReactNode }> | undefined
  const Screen = screen?.LaptopPanel
  return <div className="dash">
    <header className="nav"><Logo /><div className="row-g"><MoverHeaderBadge /><StatusPill link={ctx.link} /><ConnRelayNote link={ctx.link} /><SessionMenu ctx={ctx} onDisconnect={() => endPair(ctx)} /></div></header>
    {waitingPhone && <div className="banner warn dash-wait" data-testid="reconnecting-banner">Reconnecting…{pairDifferent ? <button type="button" data-testid="reconnect-pair-different" onClick={() => endPair(ctx)}>Pair a different phone</button> : null}</div>}
    {ctx.link.rememberListenOtherTab && (
      <p className="mut small remember-other-tab" data-testid="remember-other-tab">
        Saved phones are connected in another tab.
      </p>
    )}
    <KeepAwakeCard />
    <SavedPhonesPanel ctx={ctx} />
    <div className="grid">
      <div className="col dash-remote">{rest.filter((f) => f.laptopColumn === 'left').map(panel)}</div>
      <div className="col dash-files" data-testid="send-files">{Files ? <Files ctx={ctx}>{Screen ? <Screen ctx={ctx} /> : null}</Files> : null}</div>
      <div className="col dash-side">{rest.filter((f) => (f.laptopColumn ?? 'right') === 'right').map(panel)}</div>
    </div>
  </div>
}
