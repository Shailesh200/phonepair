import React, { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { Link } from '../../core/link'
import { Icon } from '../../core/icons'
import { copyText } from '../../core/util'
import { joinUrl } from './relay'

export function QrCard({ link, onNewCode, onToast }: { link: Link; onNewCode: () => void; onToast: (t: string) => void }) {
  const code = link.code
  const url = joinUrl(location.origin, code)
  const [qr, setQr] = useState('')
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 520, color: { dark: '#0F172A', light: '#FFFFFF' }, errorCorrectionLevel: 'M' }).then(setQr)
  }, [url])

  const s = link.status
  const wait =
    s === 'waiting' ? 'Waiting for your phone…'
    : s === 'reconnecting' ? 'Reconnecting…'
    : s === 'starting' ? 'Getting ready…'
    : s === 'error' ? link.error
    : 'Connecting…'

  const copy = async (text: string, okMsg: string) => onToast((await copyText(text)) ? okMsg : 'Copy blocked by browser')

  return (
    <section className="qr-card card">
      <div className="qr">
        {qr ? <img src={qr} alt={`QR code for ${url}`} data-testid="qr" /> : <div className="qr-ph" />}
        <span className="qr-mark"><span className="mark"><span /><span /></span></span>
      </div>
      <p className="wait"><span className={'spin' + (s === 'waiting' || s === 'reconnecting' ? '' : ' paused')} />{wait}</p>
      <p className="mut small">or type this code at <b>{location.host}</b> on your phone</p>
      <div className="code" data-testid="pair-code" aria-label={`Pairing code ${code}`}>
        {code.split('').map((c, i) => <span key={i}>{c}</span>)}
      </div>
      <div className="qr-actions">
        <button type="button" className="btn ghost sm" onClick={() => copy(code, 'Code copied')}>Copy code</button>
        <button type="button" className="btn ghost sm" onClick={() => copy(url, 'Link copied')}>Copy link</button>
        <button type="button" className="btn soft sm" data-testid="new-code" onClick={onNewCode}>New code</button>
      </div>
      <p className="mut small lock" id="privacy"><Icon n="lock" /> Direct device-to-device · end-to-end encrypted</p>
    </section>
  )
}
