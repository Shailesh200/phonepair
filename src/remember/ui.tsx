import { useRef, useState, useSyncExternalStore } from 'react'
import type { CoreCtx } from '../core/bus'
import { allowRemember, denyRemember, forgetGuestLaptop, forgetGuestLaptopLocal, forgetHostPhone, rememberPrompt } from './index'
import {
  DEVICE_NAME_MAX,
  deviceLabel,
  deviceMetaRevision,
  getDeviceMeta,
  renameDevice,
  sortFavouritesFirst,
  subscribeDeviceMeta,
  toggleFavourite,
} from './deviceMeta'
import { loadGuestStore, loadHostStore } from './storage'
import { rememberStorageEpoch } from './storageNotify'
import type { SavedLaptop } from './storage'

function useDeviceMeta() {
  useSyncExternalStore(subscribeDeviceMeta, deviceMetaRevision, deviceMetaRevision)
}

function DeviceNameEditor({ id, fallback }: { id: string; fallback: string }) {
  useDeviceMeta()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const skipSave = useRef(false)
  const shown = deviceLabel(id, fallback)

  if (!editing) {
    return (
      <button
        type="button"
        className="device-name"
        data-testid="device-name"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          skipSave.current = false
          setDraft(shown)
          setEditing(true)
        }}
      >
        {shown}
      </button>
    )
  }

  return (
    <input
      className="device-name-input"
      data-testid="device-name-input"
      aria-label="Device name"
      value={draft}
      autoFocus
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => {
        const chars = Array.from(e.target.value)
        setDraft(chars.length > DEVICE_NAME_MAX ? chars.slice(0, DEVICE_NAME_MAX).join('') : e.target.value)
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
          e.preventDefault()
          skipSave.current = true
          renameDevice(id, draft)
          setEditing(false)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          skipSave.current = true
          setEditing(false)
        }
      }}
      onBlur={() => {
        if (skipSave.current) {
          skipSave.current = false
          return
        }
        renameDevice(id, draft)
        setEditing(false)
      }}
    />
  )
}

function FavouriteToggle({ id }: { id: string }) {
  useDeviceMeta()
  const fav = getDeviceMeta(id).fav === true
  return (
    <button
      type="button"
      className="device-fav"
      data-testid="device-fav"
      aria-label="Favourite"
      aria-pressed={fav}
      onClick={() => toggleFavourite(id)}
    >
      {fav ? '★' : '☆'}
    </button>
  )
}

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
  useDeviceMeta()
  const store = loadHostStore()
  if (!store?.phones.length) return null
  const phones = sortFavouritesFirst(store.phones, (p) => getDeviceMeta(p.id).fav === true)
  return (
    <div className="remember-panel card" data-testid="saved-phones">
      <h4>Connected devices</h4>
      <ul className="remember-list">
        {phones.map((p) => (
          <li key={p.id} data-testid="saved-phone">
            <FavouriteToggle id={p.id} />
            <DeviceNameEditor id={p.id} fallback={p.name} />
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
  useDeviceMeta()
  const { laptops } = loadGuestStore()
  if (!laptops.length) return null
  const ordered = sortFavouritesFirst(laptops, (lap) => getDeviceMeta(lap.listenId).fav === true)
  return (
    <div className="remember-saved">
      <p className="mut saved-h">Connected devices</p>
      <ul className="remember-list" data-testid="saved-laptops">
        {ordered.map((lap) => (
          <li
            key={lap.listenId}
            data-testid="saved-laptop"
            data-listen-name={deviceLabel(lap.listenId, lap.name)}
          >
            <FavouriteToggle id={lap.listenId} />
            <DeviceNameEditor id={lap.listenId} fallback={lap.name} />
            <button
              type="button"
              className="btn ghost"
              data-testid="saved-laptop-connect"
              onClick={() => onPick(lap)}
            >
              Connect
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
