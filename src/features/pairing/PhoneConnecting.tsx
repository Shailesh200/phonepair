import React, { useEffect, useState } from 'react'
import { Logo } from '../../core/ui'
import type { Link } from '../../core/link'
import { SavedLaptopsList } from '../../remember/ui'
import type { CoreCtx } from '../../core/bus'
import type { SavedLaptop } from '../../remember/storage'

const SLOW_MS = 15_000

export function PhoneConnecting({
  link,
  onLeave,
  onRetry,
  onRemember,
  rememberMode,
  ctx,
}: {
  link: Link
  onLeave: () => void
  onRetry: () => void
  onRemember?: (lap: SavedLaptop) => void
  rememberMode?: boolean
  ctx?: CoreCtx
}) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t0 = Date.now()
    const check = () => setSlow(Date.now() - t0 >= SLOW_MS)
    check()
    const id = window.setInterval(check, 1000)
    return () => clearInterval(id)
  }, [link.code])

  return (
    <div className="phone-wrap">
      <div className="phone-page center" data-testid="phone-connecting">
        <Logo />
        <span className="spin big" />
        <h2>Connecting to your laptop…</h2>
        {rememberMode ? (
          <p className="mut">Reconnecting to your saved laptop…</p>
        ) : (
          <p className="mut">
            Code <b className="mono">{link.code}</b>. Keep the PhonePair page open on your laptop.
          </p>
        )}
        {onRemember && <SavedLaptopsList ctx={ctx} onPick={onRemember} />}
        {link.guestStallRetrying && (
          <p className="mut stall-retry" role="status">Still connecting… retrying</p>
        )}
        {slow && (
          <div className="slow-connect" role="status">
            <p className="mut">Taking longer than usual. Make sure the PhonePair page is open on your laptop</p>
            <button type="button" className="btn soft" onClick={onRetry}>Retry</button>
          </div>
        )}
        <button type="button" className="linkbtn" onClick={onLeave}>Use a different code</button>
      </div>
    </div>
  )
}
