import React, { useRef } from 'react'
import { Logo } from '../../core/ui'
import { CodeBoxes } from './CodeBoxes.tsx'
import { MSG_REMEMBER_DENIED, MSG_REMEMBER_UNREACHABLE } from './errors'
import { lastLaptopSession } from './session'
import { SavedLaptopsList } from '../../remember/ui'
import type { SavedLaptop } from '../../remember/storage'

export function CodeEntry({
  onCode,
  onHost,
  onRemember,
  error,
  onClearError,
  onForgetDenied,
}: {
  onCode: (c: string) => void
  onHost?: () => void
  onRemember?: (lap: SavedLaptop) => void
  error?: string
  onClearError?: () => void
  onForgetDenied?: () => void
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
          {onRemember && <SavedLaptopsList onPick={onRemember} />}
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
            {error && (
              <div
                className="err-block"
                role="alert"
                data-testid={
                  error === MSG_REMEMBER_DENIED
                    ? 'remember-denied'
                    : error === MSG_REMEMBER_UNREACHABLE
                      ? 'remember-unreachable'
                      : undefined
                }
              >
                <p className="err">{error}</p>
                {error === MSG_REMEMBER_DENIED && onForgetDenied && (
                  <button
                    type="button"
                    className="btn sm"
                    data-testid="remember-denied-forget"
                    onClick={onForgetDenied}
                  >
                    Forget
                  </button>
                )}
              </div>
            )}
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
