import { useEffect, useRef, useState } from 'react'
import {
  applyConnectFocus,
  codeSubmitEnabled,
  connectCardState,
  connectStepBodies,
  connectStepStates,
  detectConnectPlatform,
  editConnectCode,
  initialConnectGuide,
  reduceConnectGuide,
  type ConnectGuideEvent,
  type ConnectPlatform,
  type ConnectStep,
  type HelperAttempt,
  type HelperStatus,
} from './connectGuide'
import './connectGuide.css'

const MAC_OPEN = 'Open the DMG, drag PhonePair Helper to Applications, then open it.'
const WIN_OPEN = 'Run the installer. If SmartScreen appears, click More info, then Run anyway.'
const MAC_ACCESS = 'Allow Accessibility: System Settings > Privacy & Security > Accessibility > turn on PhonePair Helper. This lets it move the pointer and type.'
const WIN_ACCESS = 'Allow access: if Windows asks to allow PhonePair Helper through the firewall or to make changes, click Allow / Yes.'

const COPY: Record<ConnectStep, { title: string; body: string }> = {
  download: {
    title: 'Download the helper',
    body: 'Download PhonePair Helper, then come back to this page.',
  },
  'open-mac': { title: 'Open it', body: MAC_OPEN },
  'open-win': { title: 'Open it', body: WIN_OPEN },
  'accessibility-mac': { title: 'Allow access', body: MAC_ACCESS },
  'access-win': { title: 'Allow access', body: WIN_ACCESS },
  code: { title: 'Enter the 6-digit code', body: 'Type the 6-digit code the helper shows.' },
}

function readPlatform(): ConnectPlatform {
  if (typeof navigator === 'undefined') return 'mac'
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return detectConnectPlatform({ userAgentData: nav.userAgentData, platform: nav.platform })
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
  const [guide, setGuide] = useState(() => initialConnectGuide(readPlatform()))
  const guideRef = useRef(guide)
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const guideSectionRef = useRef<HTMLElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const digitRefs = useRef<Array<HTMLInputElement | null>>([])
  const focusIntent = useRef<'step' | 'open' | null>(null)
  guideRef.current = guide
  const cardState = connectCardState(guide)
  const steps = connectStepStates(guide)

  useEffect(() => {
    setGuide((current) => reduceConnectGuide(current, { type: 'signals', signals: { status, attempt } }))
  }, [status, attempt])

  useEffect(() => {
    const card = rootRef.current?.closest('[data-testid="remote-panel"]')
    if (!(card instanceof HTMLElement)) return
    card.dataset.os = guide.platform
    card.dataset.state = cardState
  }, [guide.platform, cardState])

  useEffect(() => {
    focusIntent.current = applyConnectFocus({
      intent: focusIntent.current,
      open: guide.open,
      steps,
      platform: guide.platform,
      query: (testid) => guideSectionRef.current?.querySelector<HTMLElement>(`[data-testid="${testid}"]`) ?? null,
      guide: guideSectionRef.current,
      openButton: openButtonRef.current,
    })
  }, [guide, steps])

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

  const focusDigit = (index: number) => {
    const el = digitRefs.current[Math.max(0, Math.min(5, index))]
    el?.focus()
  }

  const onDigit = (index: number, raw: string) => {
    const next = editConnectCode(guide.code, index, raw)
    onEvent({ type: 'code', value: next })
    if (raw.replace(/\D/g, '')) focusDigit(Math.min(next.length, 5))
    else focusDigit(Math.max(0, index - 1))
  }

  const statusText = cardState === 'connected' ? 'Connected' : cardState === 'waiting' ? 'Waiting for helper' : 'Not connected'
  const arrowOn = codeSubmitEnabled(guide.code, guide.signals.status)

  return <div ref={rootRef} data-os={guide.platform} data-state={cardState}>
    <div className="full-laptop-row">
      <div>
        <b>Full laptop</b>
        <p className={'mut small helper-status' + (cardState === 'connected' ? ' on' : '')} data-testid="helper-status" aria-live="polite">{statusText}</p>
      </div>
    </div>
    <div className="pp-os-toggle" role="radiogroup" aria-label="Operating system" data-testid="os-toggle" onKeyDown={(e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      e.preventDefault()
      onEvent({ type: 'platform', platform: guide.platform === 'mac' ? 'windows' : 'mac' })
    }}>
      <button type="button" role="radio" data-os-choice="mac" aria-checked={guide.platform === 'mac'} onClick={() => onEvent({ type: 'platform', platform: 'mac' })}>Mac</button>
      <button type="button" role="radio" data-os-choice="windows" aria-checked={guide.platform === 'windows'} onClick={() => onEvent({ type: 'platform', platform: 'windows' })}>Windows</button>
    </div>
    <div data-testid="connect-laptop">
      <button ref={openButtonRef} type="button" className="btn big pp-connect" data-testid="connect-open" data-state={cardState} onClick={() => onEvent({ type: 'open-guide' })}>Connect laptop control</button>
    </div>
    <section ref={guideSectionRef} className="connect-guide" data-testid="connect-guide" aria-label="Connect the helper" tabIndex={-1}>
      <ol className="pp-steps" data-testid="helper-steps">
        {steps.map((step, index) => {
          const active = step.state === 'current' || step.state === 'error' || step.state === 'connecting' || step.state === 'connected'
          return <li
            key={step.id}
            className={'pp-step connect-step' + (active ? ' pp-step--active' : '') + (step.state === 'done' ? ' pp-step--done' : '')}
            data-testid={`connect-step-${step.id}`}
            data-state={step.state}
            data-manual={step.manual ? 'true' : 'false'}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className="step-n">{index + 1}</span>
            <div>
              <b>{COPY[step.id].title}</b>
              {connectStepBodies(step.id).includes('generic') ? <p className="mut small">{COPY[step.id].body}</p> : null}
              {step.id === 'download' ? <>
                <p className="mut small" data-testid="helper-hint">Download the PhonePair Helper, open it, and type the 6-digit code it shows.</p>
                <p className="mut small">
                  <a className="mut" href="https://github.com/Shailesh200/phonepair/releases/latest/download/PhonePair-Helper-mac.zip" target="_blank" rel="noreferrer" data-testid="download-mac-zip">Mac .zip</a>
                  {' · '}
                  <a className="mut" href="https://github.com/Shailesh200/phonepair/releases/latest" target="_blank" rel="noopener noreferrer" data-testid="other-downloads">Other downloads</a>
                </p>
              </> : null}
              {step.id === 'open-mac' ? <p className="mut small for-mac" data-testid="mac-open-steps">{MAC_OPEN}</p> : null}
              {step.id === 'open-win' ? <p className="mut small for-win" data-testid="win-open-steps">{WIN_OPEN}</p> : null}
              {step.id === 'accessibility-mac' ? <p className="mut small for-mac">{MAC_ACCESS}</p> : null}
              {step.id === 'access-win' ? <p className="mut small for-win">{WIN_ACCESS}</p> : null}
              {step.error ? <p className="err" data-testid={`connect-error-${step.id}`} role="status">{step.error}</p> : null}
              {step.manual && step.state === 'current' ? <button type="button" className="btn" data-testid={`connect-confirm-${step.id}`} onClick={() => onEvent({ type: 'confirm' })}>I've done this</button> : null}
              {step.state === 'error' ? <button type="button" className="btn" data-testid={`connect-retry-${step.id}`} onClick={() => onEvent({ type: 'retry' })}>Try again</button> : null}
            </div>
            {step.id === 'code' && step.state !== 'connected' ? <form className="pp-code helper-code" data-testid="helper-code" role="group" aria-label="Helper code" onSubmit={(e) => { e.preventDefault(); onEvent({ type: 'submit' }) }}>
              {Array.from({ length: 6 }, (_, i) => <input
                key={i}
                ref={(el) => { digitRefs.current[i] = el }}
                className="pp-code-input"
                data-testid={`code-digit-${i + 1}`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={1}
                aria-label={`Digit ${i + 1}`}
                value={guide.code[i] ?? ''}
                onChange={(e) => onDigit(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !guide.code[i]) {
                    e.preventDefault()
                    onDigit(Math.max(0, i - 1), '')
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault()
                  onDigit(i, e.clipboardData.getData('text'))
                }}
              />)}
              <button type="submit" className="pp-code-go" data-testid="connect-submit" aria-label="Connect" disabled={!arrowOn}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
              </button>
            </form> : null}
            {step.id === 'download' ? <p className="helper-downloads">
              <a className="btn ghost pp-os-btn" href="https://github.com/Shailesh200/phonepair/releases/latest/download/PhonePair-Helper-mac.dmg" target="_blank" rel="noreferrer" data-testid="download-mac">Download for Mac</a>
              <a className="btn ghost pp-os-btn" href="https://github.com/Shailesh200/phonepair/releases/latest/download/PhonePair-Helper-win.exe" target="_blank" rel="noreferrer" data-testid="download-win">Download for Windows</a>
            </p> : null}
          </li>
        })}
      </ol>
      <button type="button" className="btn ghost" data-testid="connect-back" onClick={() => onEvent({ type: 'back' })}>Back</button>
    </section>
    {cardState === 'connected' ? <>
      <p className="mut small">Your phone controls the whole laptop. Disconnect to keep control inside this tab.</p>
      <button type="button" className="btn ghost" data-testid="connect-disconnect" onClick={() => onEvent({ type: 'user-disconnect' })}>Disconnect</button>
    </> : null}
    {import.meta.env.DEV ? <details>
      <summary className="pp-dev-link">Developer</summary>
      <p className="mut small helper-dev-note" data-testid="helper-dev-note"><code>cd helper && npm start</code></p>
    </details> : null}
  </div>
}
