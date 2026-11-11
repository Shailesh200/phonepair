import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { Link } from '../../core/link'
import { Icon } from '../../core/icons'
import { copyText } from '../../core/util'
import type { QrCardPhase } from './useHostPairFlow'
import { joinUrl } from './relay'

export function QrCard({
  link,
  onNewCode,
  onTryAgain,
  onToast,
  phase,
}: {
  link: Link
  onNewCode: () => void
  onTryAgain: () => void
  onToast: (t: string) => void
  phase: QrCardPhase
}) {
  const code = link.code
  const url = joinUrl(location.origin, code)
  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 520, color: { dark: '#0F172A', light: '#FFFFFF' }, errorCorrectionLevel: 'M' }).then(setQr)
  }, [url])

  const s = link.status
  const isErr = s === 'error' && !!link.error

  const statusLine = (() => {
    if (isErr) return null
    if (phase === 'paired') return { spin: false, tick: true, text: 'Paired' }
    if (phase === 'found') {
      const name = link.remoteName
      return { spin: true, tick: false, text: name ? `Phone found, connecting… · ${name}` : 'Phone found, connecting…' }
    }
    if (s === 'waiting') return { spin: true, tick: false, text: 'Waiting for your phone…' }
    if (s === 'reconnecting') return { spin: true, tick: false, text: 'Reconnecting…' }
    if (s === 'starting') return { spin: true, tick: false, text: 'Getting ready…' }
    if (s === 'connecting') return { spin: true, tick: false, text: link.remoteName ? `Phone found, connecting… · ${link.remoteName}` : 'Phone found, connecting…' }
    return { spin: true, tick: false, text: 'Connecting…' }
  })()

  const copyCode = async () => onToast((await copyText(code)) ? 'Code copied' : 'Copy blocked by browser')

  return (
    <section className="qr-card card">
      <div className="qr">
        {qr ? <img src={qr} alt={`QR code for ${url}`} data-testid="qr" /> : <div className="qr-ph" />}
        <span className="qr-mark"><span className="mark"><span /><span /></span></span>
      </div>
      {isErr ? (
        <div className="qr-err" role="alert">
          <p className="err">{link.error}</p>
          <button type="button" className="btn sm" onClick={onTryAgain}>Try again</button>
        </div>
      ) : statusLine && (
        <p className="wait">
          {statusLine.tick
            ? <span className="ok-tick" aria-hidden />
            : <span className={statusLine.spin ? 'spin' : 'spin paused'} />}
          {statusLine.text}
        </p>
      )}
      <p className="mut small">or type this code at <b>{location.host}</b> on your phone</p>
      <div
        className="code code-click"
        data-testid="pair-code"
        role="button"
        tabIndex={0}
        aria-label={`Pairing code ${code}. Click to copy.`}
        onClick={copyCode}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyCode() } }}
      >
        {code.split('').map((c, i) => <span key={i}>{c}</span>)}
      </div>
      <div className="qr-actions">
        <button type="button" className="linkbtn muted sm refresh-link" data-testid="new-code" onClick={onNewCode}>New code</button>
      </div>
      <p className="mut small lock" id="privacy"><Icon n="lock" /> Direct device-to-device · end-to-end encrypted</p>
    </section>
  )
}
