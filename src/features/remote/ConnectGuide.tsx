import { useEffect, useRef, useState } from 'react'
import {
  applyConnectFocus,
  connectStepStates,
  initialConnectGuide,
  reduceConnectGuide,
  type ConnectGuideEvent,
  type ConnectStep,
  type HelperAttempt,
  type HelperStatus,
} from './connectGuide'

const COPY: Record<ConnectStep, { title: string; body: string }> = {
  download: {
    title: 'Download the helper',
    body: 'Download PhonePair Helper for this computer.',
  },
  open: {
    title: 'Open it',
    body: 'Open the helper and leave it running. It shows a 6-digit code.',
  },
  accessibility: {
    title: 'Allow Accessibility',
    body: 'Allow Accessibility when asked so Control works. On a Mac, open System Settings, then Privacy & Security, then Accessibility, and enable the app that launched the helper.',
  },
  code: {
    title: 'Enter the code',
    body: 'Type the 6-digit code the helper shows.',
  },
}

export function ConnectGuide({
  status,
  attempt,
  onSubmitCode,
  onDisconnect,
}: {
  status: HelperStatus
  attempt: HelperAttempt
  onSubmitCode: (code: string) => void
  onDisconnect: () => void
}) {
  const [guide, setGuide] = useState(initialConnectGuide)
  const guideRef = useRef(guide)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const guideSectionRef = useRef<HTMLElement>(null)
  const focusIntent = useRef<'step' | 'open' | null>(null)
  guideRef.current = guide

  useEffect(() => {
    setGuide((current) => reduceConnectGuide(current, { type: 'signals', signals: { status, attempt } }))
  }, [status, attempt])

  useEffect(() => {
    focusIntent.current = applyConnectFocus({
      intent: focusIntent.current,
      open: guide.open,
      steps: connectStepStates(guide),
      query: (testid) => guideSectionRef.current?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? null,
      guide: guideSectionRef.current,
      openButton: openButtonRef.current,
    })
  }, [guide])

  const onEvent = (event: ConnectGuideEvent) => {
    if (event.type === 'open-guide') focusIntent.current = 'step'
    if (event.type === 'close-guide' || event.type === 'user-disconnect' || (event.type === 'back' && guideRef.current.open && guideRef.current.step <= 0)) {
      focusIntent.current = 'open'
    }
    if (event.type === 'submit') {
      const next = reduceConnectGuide(guideRef.current, event)
      guideRef.current = next
      setGuide(next)
      if (next.error || next.signals.status !== 'off') return
      onSubmitCode(next.code)
      return
    }
    if (event.type === 'user-disconnect') {
      setGuide((current) => reduceConnectGuide(current, event))
      onDisconnect()
      return
    }
    setGuide((current) => reduceConnectGuide(current, event))
  }

  const paired = guide.signals.status === 'connected'
  const connecting = guide.signals.status === 'connecting'
  const statusText = paired ? 'Connected' : connecting ? 'Connecting…' : 'Not connected'
  const steps = connectStepStates(guide)

  return <>
    <div className="full-laptop-row">
      <div>
        <b>Full laptop</b>
        <p className={'mut small helper-status' + (paired ? ' on' : '')} data-testid="helper-status" aria-live="polite">{statusText}</p>
      </div>
    </div>
    {guide.open ? (
      <section ref={guideSectionRef} className="connect-guide" data-testid="connect-guide" aria-label="Connect the helper" tabIndex={-1}>
        <p className="mut small" data-testid="helper-hint">Download the PhonePair Helper, open it, and type the 6-digit code it shows.</p>
        <ol>
          {steps.map((step, index) => {
            const show = step.state === 'current' || step.state === 'error' || step.state === 'connecting' || step.state === 'connected'
            return <li
              key={step.id}
              className="connect-step"
              data-testid={`connect-step-${step.id}`}
              data-state={step.state}
              data-manual={step.manual ? 'true' : 'false'}
              aria-current={step.state === 'current' ? 'step' : undefined}
            >
              <h4>{index + 1}. {COPY[step.id].title}</h4>
              {show ? <div>
                <p className="mut small">{COPY[step.id].body}</p>
                {step.id === 'download' ? <>
                  <p className="helper-downloads">
                    <a className="linkbtn sm" href="https://github.com/Shailesh200/phonepair/releases/latest/download/PhonePair-Helper-mac.dmg" target="_blank" rel="noreferrer" data-testid="download-mac">Download for Mac</a>
                    <a className="linkbtn sm" href="https://github.com/Shailesh200/phonepair/releases/latest/download/PhonePair-Helper-win.exe" target="_blank" rel="noreferrer" data-testid="download-win">Download for Windows</a>
                  </p>
                  <p className="mut small"><a className="mut" href="https://github.com/Shailesh200/phonepair/releases/latest" target="_blank" rel="noopener noreferrer" data-testid="other-downloads">Other downloads</a></p>
                </> : null}
                {step.id === 'open' ? <>
                  <p className="mut small" data-testid="mac-open-steps">Open the DMG, drag PhonePair Helper to Applications, and open it. Allow Accessibility when asked so Control works.</p>
                  <p className="mut small" data-testid="win-open-steps">If SmartScreen appears, click More info, then Run anyway.</p>
                </> : null}
                {step.id === 'code' && step.state !== 'connected' ? <form onSubmit={(e) => { e.preventDefault(); onEvent({ type: 'submit' }) }}>
                  <input className="helper-code" data-testid="helper-code" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={6} placeholder="6-digit code" aria-label="Helper code" value={guide.code} disabled={connecting} onChange={(e) => onEvent({ type: 'code', value: e.target.value })} />
                  <button type="submit" className="btn" data-testid="connect-submit" disabled={connecting}>Pair</button>
                </form> : null}
                {step.id === 'code' && step.state === 'connected' ? <>
                  <p className="mut small">Your phone controls the whole laptop. Disconnect to keep control inside this tab.</p>
                  <button type="button" className="btn ghost" data-testid="connect-disconnect" onClick={() => onEvent({ type: 'user-disconnect' })}>Disconnect</button>
                </> : null}
                {step.error ? <p className="err" data-testid={`connect-error-${step.id}`} role="status">{step.error}</p> : null}
                {step.manual && step.state === 'current' ? <button type="button" className="btn" data-testid={`connect-confirm-${step.id}`} onClick={() => onEvent({ type: 'confirm' })}>I've done this</button> : null}
                {step.state === 'error' ? <button type="button" className="btn" data-testid={`connect-retry-${step.id}`} onClick={() => onEvent({ type: 'retry' })}>Try again</button> : null}
              </div> : null}
            </li>
          })}
        </ol>
        <button type="button" className="btn ghost" data-testid="connect-back" onClick={() => onEvent({ type: 'back' })}>Back</button>
      </section>
    ) : (
      <button ref={openButtonRef} type="button" className="btn" data-testid="connect-open" data-state={paired ? 'connected' : guide.error ? 'error' : 'idle'} onClick={() => onEvent({ type: 'open-guide' })}>
        {paired ? 'Connected' : 'Connect'}
      </button>
    )}
    {import.meta.env.DEV ? <p className="mut small helper-dev-note" data-testid="helper-dev-note">or run from source: <code>cd helper && npm start</code></p> : null}
  </>
}
