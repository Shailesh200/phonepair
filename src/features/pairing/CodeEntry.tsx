import React, { useEffect, useRef, useState } from 'react'
import { Logo } from '../../core/ui'
import { isValidPairCode, normalizePairCode } from './code'

export function CodeEntry({
  onCode,
  onHost,
  error,
  onClearError,
}: {
  onCode: (c: string) => void
  onHost?: () => void
  error?: string
  onClearError?: () => void
}) {
  const [v, setV] = useState('')
  const sent = useRef('')
  const ok = isValidPairCode(v)

  useEffect(() => {
    if (!ok || sent.current === v) return
    sent.current = v
    onCode(v)
  }, [ok, v, onCode])

  const onInput = (raw: string) => {
    onClearError?.()
    sent.current = ''
    setV(normalizePairCode(raw))
  }

  return (
    <div className="phone-wrap">
      <div className="phone-page entry">
        <div className="top"><Logo small /></div>
        <div className="entry-body">
          <h1>Pair with your laptop</h1>
          <p className="mut">Open <b>{location.host}</b> on your laptop, then scan the QR code with your camera, or type the 6-character code here.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (ok) onCode(v) }}>
            <input
              data-testid="code-input"
              className="code-input"
              value={v}
              onChange={(e) => onInput(e.target.value)}
              onPaste={(e) => { e.preventDefault(); onInput(e.clipboardData.getData('text')) }}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              maxLength={6}
            />
            {error && <p className="err" role="alert">{error}</p>}
            <button data-testid="code-join" className="btn big" type="submit" disabled={!ok}>Connect</button>
          </form>
          {onHost && <button type="button" className="linkbtn" onClick={onHost}>Use this device as the laptop side instead</button>}
        </div>
      </div>
    </div>
  )
}
