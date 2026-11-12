import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
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

function DeviceNameEditor({ id, fallback, onEditing }: { id: string; fallback: string; onEditing: (editing: boolean) => void }) {
  useDeviceMeta()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const skipSave = useRef(false)
  const shown = deviceLabel(id, fallback)
  const setMode = (next: boolean) => {
    setEditing(next)
    onEditing(next)
  }

  if (!editing) {
    return (
      <>
        <div className="grow" data-testid="device-name"><b>{shown}</b></div>
        <button
          type="button"
          className="pp-icon-toggle"
          data-testid="device-rename"
          aria-label={`Rename ${shown}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            skipSave.current = false
            setDraft(shown)
            setMode(true)
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 20h4l10-10-4-4L4 16v4z" />
            <path d="m13 7 4 4" />
          </svg>
        </button>
      </>
    )
  }

  return (
    <input
      className="pp-rename-input"
      data-testid="device-rename-input"
      aria-label="Device name"
      value={draft}
      maxLength={DEVICE_NAME_MAX}
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
          setMode(false)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          skipSave.current = true
          setMode(false)
        }
      }}
      onBlur={() => {
        if (skipSave.current) {
          skipSave.current = false
          return
        }
        renameDevice(id, draft)
        setMode(false)
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
      className="pp-icon-toggle pp-star"
      data-testid="device-fav"
      aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={fav}
      onClick={() => toggleFavourite(id)}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="m12 3 2.6 5.6L21 9.3l-4.5 4.2 1.2 6.2L12 16.8 6.3 19.7l1.2-6.2L3 9.3l6.4-.7L12 3z" />
      </svg>
    </button>
  )
}

function ConnectedDeviceRow({
  id,
  fallback,
  testId,
  listenName,
  children,
}: {
  id: string
  fallback: string
  testId: string
  listenName?: string
  children?: ReactNode
}) {
  const [editing, setEditing] = useState(false)
  return (
    <li
      className={'pp-list-row pp-device-row' + (editing ? ' is-editing' : '')}
      data-testid={testId}
      data-listen-name={listenName}
    >
      <DeviceNameEditor id={id} fallback={fallback} onEditing={setEditing} />
      <FavouriteToggle id={id} />
      {children}
    </li>
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
  const phones = sortFavouritesFirst(
    store.phones,
    (p) => getDeviceMeta(p.id).fav === true,
    (p) => getDeviceMeta(p.id).lastConnectedMs ?? null,
  )
  return (
    <div className="remember-panel card" data-testid="saved-phones">
      <h4>Connected devices</h4>
      <ul className="remember-list pp-list">
        {phones.map((p) => (
          <ConnectedDeviceRow key={p.id} id={p.id} fallback={p.name} testId="saved-phone">
            <button
              type="button"
              className="linkbtn"
              data-testid="saved-phone-forget"
              onClick={() => { forgetHostPhone(ctx, p.id) }}
            >
              Forget
            </button>
          </ConnectedDeviceRow>
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
  const ordered = sortFavouritesFirst(
    laptops,
    (lap) => getDeviceMeta(lap.listenId).fav === true,
    (lap) => getDeviceMeta(lap.listenId).lastConnectedMs ?? null,
  )
  return (
    <div className="remember-saved">
      <p className="mut saved-h">Connected devices</p>
      <ul className="remember-list pp-list" data-testid="saved-laptops">
        {ordered.map((lap) => (
          <ConnectedDeviceRow
            key={lap.listenId}
            id={lap.listenId}
            fallback={lap.name}
            testId="saved-laptop"
            listenName={deviceLabel(lap.listenId, lap.name)}
          >
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
          </ConnectedDeviceRow>
        ))}
      </ul>
    </div>
  )
}
