import React, { useRef } from 'react'
import { Logo } from '../../core/ui'
import { CodeBoxes } from './CodeBoxes'
import { lastLaptopSession } from './session'

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
  const sent = useRef('')
  const last = lastLaptopSession()

  const complete = (code: string) => {
    if (sent.current === code) return
    sent.current = code
    onCode(code)
  }

  return (
    <div className="phone-wrap">
      <div className="phone-page entry">
        <div className="top"><Logo small /></div>
        <div className="entry-body">
          <h1>Pair with your laptop</h1>
          <p className="mut">Open <b>{location.host}</b> on your laptop, then scan the QR code with your camera, or type the 6-character code here.</p>
          {last && (
            <button
              type="button"
              className="btn ghost big reconnect-last"
              onClick={() => complete(last.code)}
            >
              Reconnect to {last.name}
            </button>
          )}
          <form onSubmit={(e) => e.preventDefault()}>
            <CodeBoxes
              key={error || 'fresh'}
              autoFocus
              onChange={() => onClearError?.()}
              onComplete={complete}
            />
            {error && <p className="err" role="alert">{error}</p>}
            <button data-testid="code-join" className="btn big hidden" type="submit" tabIndex={-1}>Connect</button>
          </form>
          {onHost && (
            <button type="button" className="linkbtn muted" onClick={onHost}>
              Use this device as the laptop side instead
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
