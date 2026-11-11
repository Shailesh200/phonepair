import React from 'react'
import type { CoreCtx } from '../core/bus'
import { allowRemember, denyRemember, forgetGuestLaptop, forgetGuestLaptopLocal, forgetHostPhone, rememberPrompt } from './index'
import { loadGuestStore, loadHostStore } from './storage'
import { rememberStorageEpoch } from './storageNotify'
import type { SavedLaptop } from './storage'

export function RememberPrompt({ ctx }: { ctx: CoreCtx }) {
  const open = rememberPrompt.use()
  if (!open || !ctx.link.connected) return null
  return (
    <div className="remember-overlay" role="dialog" aria-labelledby="remember-title">
      <div className="remember-modal card" data-testid="remember-prompt">
        <h3 id="remember-title">Remember this phone?</h3>
        <p className="mut">It can reconnect later without entering a code. Nothing is saved unless you tap Allow.</p>
        <div className="remember-actions">
          <button type="button" className="btn ghost" data-testid="remember-no" onClick={() => denyRemember()}>No</button>
          <button type="button" className="btn" data-testid="remember-allow" onClick={() => allowRemember(ctx)}>Allow</button>
        </div>
      </div>
    </div>
  )
}

export function SavedPhonesPanel({ ctx }: { ctx: CoreCtx }) {
  rememberStorageEpoch.use()
  const store = loadHostStore()
  if (!store?.phones.length) return null
  return (
    <div className="remember-panel card" data-testid="saved-phones">
      <h4>Remembered phones</h4>
      <ul className="remember-list">
        {store.phones.map((p) => (
          <li key={p.id} data-testid="saved-phone">
            <span>{p.name}</span>
            <button
              type="button"
              className="linkbtn"
              data-testid="saved-phone-forget"
              onClick={() => { forgetHostPhone(ctx, p.id) }}
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SavedLaptopsList({
  ctx,
  onPick,
}: {
  ctx?: CoreCtx
  onPick: (lap: SavedLaptop) => void
}) {
  rememberStorageEpoch.use()
  const { laptops } = loadGuestStore()
  if (!laptops.length) return null
  return (
    <div className="remember-saved">
      <p className="mut saved-h">Saved laptops</p>
      <ul className="remember-list" data-testid="saved-laptops">
        {laptops.map((lap) => (
          <li
            key={lap.listenId}
            data-testid="saved-laptop"
            data-listen-name={lap.name}
          >
            <button
              type="button"
              className="btn ghost big last"
              data-testid="saved-laptop-connect"
              onClick={() => onPick(lap)}
            >
              {lap.name}
            </button>
            <button
              type="button"
              className="linkbtn"
              data-testid="saved-laptop-forget"
              onClick={(e) => {
                e.stopPropagation()
                if (ctx) forgetGuestLaptop(ctx, lap.listenId)
                else forgetGuestLaptopLocal(lap.listenId)
              }}
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
