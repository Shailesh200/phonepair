import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
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
import {
  chooseDeviceMenuItem,
  deviceMenuActions,
  deviceMenuAfterToggle,
  deviceMenuDismissHandlers,
  deviceMenuIndexAfterKey,
  deviceMenuLabel,
  deviceMenuPlacement,
  savedLaptopConnected,
  savedPhoneConnected,
  type DeviceMenuHandlers,
} from './deviceMenu'

function useDeviceMeta() {
  useSyncExternalStore(subscribeDeviceMeta, deviceMetaRevision, deviceMetaRevision)
}

function useLinkTick(link: { subscribe: (fn: () => void) => () => void } | undefined) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!link) return
    return link.subscribe(() => setTick((n) => n + 1))
  }, [link])
}

export function applyDeviceRename(id: string, draft: string) {
  renameDevice(id, draft)
}

function DeviceNameEditor({
  id,
  fallback,
  editSignal,
  onEditing,
}: {
  id: string
  fallback: string
  editSignal: number
  onEditing: (editing: boolean) => void
}) {
  useDeviceMeta()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const skipSave = useRef(false)
  const shown = deviceLabel(id, fallback)
  const setMode = (next: boolean) => {
    setEditing(next)
    onEditing(next)
  }

  const appliedEdit = useRef(0)
  useEffect(() => {
    if (editSignal < 1 || appliedEdit.current === editSignal) return
    appliedEdit.current = editSignal
    skipSave.current = false
    setDraft(deviceLabel(id, fallback))
    setMode(true)
  }, [editSignal, id, fallback])

  if (!editing) {
    return <div className="grow pp-device-name" data-testid="device-name" title={shown}><b>{shown}</b></div>
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
          applyDeviceRename(id, draft)
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
        applyDeviceRename(id, draft)
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

const MENU_WIDTH = 220
const MENU_ROW = 44

function DeviceKebab({
  id,
  name,
  testId,
  connected,
  handlers,
  initialOpen = false,
}: {
  id: string
  name: string
  testId: string
  connected: boolean
  handlers: DeviceMenuHandlers
  initialOpen?: boolean
}) {
  const [open, setOpen] = useState(initialOpen)
  const [index, setIndex] = useState(0)
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const actions = deviceMenuActions(connected)
  const menuId = `device-menu-${id}`

  useEffect(() => {
    if (!open) return
    const dismiss = deviceMenuDismissHandlers({
      contains: (node) => !!rootRef.current?.contains(node as Node),
      close: () => setOpen(false),
    })
    document.addEventListener('keydown', dismiss.keydown)
    document.addEventListener('pointerdown', dismiss.pointerdown)
    return () => {
      document.removeEventListener('keydown', dismiss.keydown)
      document.removeEventListener('pointerdown', dismiss.pointerdown)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setBox(null)
      return
    }
    const place = () => {
      const anchor = buttonRef.current?.getBoundingClientRect()
      if (!anchor) return
      const next = deviceMenuPlacement({
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        anchorTop: anchor.top,
        anchorBottom: anchor.bottom,
        anchorRight: anchor.right,
        menuWidth: MENU_WIDTH,
        menuHeight: actions.length * MENU_ROW + 8,
      })
      setBox({ top: next.top, left: next.left, width: next.width })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, actions.length])

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        setOpen(true)
        setIndex(0)
        return
      }
      setIndex((current) => deviceMenuIndexAfterKey(current, actions.length, event.key))
    }
  }

  return (
    <div className="pp-device-kebab" ref={rootRef} onKeyDown={onMenuKey}>
      <button
        type="button"
        ref={buttonRef}
        className="pp-icon-toggle"
        data-testid="device-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`More actions for ${name}`}
        onClick={() => setOpen((current) => deviceMenuAfterToggle(current))}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={`Actions for ${name}`}
          data-testid="device-menu-list"
          className={'pp-device-menu' + (box ? ' is-fixed' : '')}
          style={box ? { top: box.top, left: box.left, width: box.width } : undefined}
        >
          {actions.map((action, itemIndex) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              tabIndex={itemIndex === index ? 0 : -1}
              data-active={itemIndex === index ? 'true' : undefined}
              data-testid={`${testId}-${action}`}
              onClick={() => chooseDeviceMenuItem(action, handlers, () => setOpen(false))}
            >
              {deviceMenuLabel(action)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function DeviceCard({
  id,
  fallback,
  testId,
  listenName,
  connected,
  onConnect,
  onDisconnect,
  onForget,
  initialMenuOpen = false,
}: {
  id: string
  fallback: string
  testId: string
  listenName?: string
  connected: boolean
  onConnect?: () => void
  onDisconnect?: () => void
  onForget: () => void
  initialMenuOpen?: boolean
}) {
  useDeviceMeta()
  const [editing, setEditing] = useState(false)
  const [editSignal, setEditSignal] = useState(0)
  const shown = deviceLabel(id, fallback)
  return (
    <li
      className={'pp-list-row pp-device-row' + (editing ? ' is-editing' : '')}
      data-testid={testId}
      data-listen-name={listenName}
    >
      <DeviceNameEditor id={id} fallback={fallback} editSignal={editSignal} onEditing={setEditing} />
      <div className="pp-device-actions">
        <FavouriteToggle id={id} />
        <DeviceKebab
          id={id}
          name={shown}
          testId={testId}
          connected={connected}
          initialOpen={initialMenuOpen}
          handlers={{
            onConnect,
            onDisconnect,
            onForget,
            onEdit: () => setEditSignal((n) => n + 1),
          }}
        />
      </div>
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
  useLinkTick(ctx.link)
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
        {phones.map((p) => {
          const label = deviceLabel(p.id, p.name)
          const connected = savedPhoneConnected({
            connected: ctx.link.connected,
            remoteName: ctx.link.remoteName,
            phoneName: p.name,
            label,
          })
          return (
            <DeviceCard
              key={p.id}
              id={p.id}
              fallback={p.name}
              testId="saved-phone"
              connected={connected}
              onConnect={() => {
                if (ctx.link.rememberListenOtherTab) return
                ctx.link.refreshRememberListen()
              }}
              onDisconnect={() => ctx.link.disconnect()}
              onForget={() => { forgetHostPhone(ctx, p.id) }}
            />
          )
        })}
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
  useLinkTick(ctx?.link)
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
        {ordered.map((lap) => {
          const connected = savedLaptopConnected({
            connected: !!ctx?.link.connected,
            rememberListenId: ctx?.link.rememberListenId,
            sessionPaired: !!ctx?.link.guestSessionPaired,
            listenId: lap.listenId,
            savedCount: ordered.length,
          })
          return (
            <DeviceCard
              key={lap.listenId}
              id={lap.listenId}
              fallback={lap.name}
              testId="saved-laptop"
              listenName={deviceLabel(lap.listenId, lap.name)}
              connected={connected}
              onConnect={() => onPick(lap)}
              onDisconnect={() => ctx?.link.disconnect()}
              onForget={() => {
                if (ctx) forgetGuestLaptop(ctx, lap.listenId)
                else forgetGuestLaptopLocal(lap.listenId)
              }}
            />
          )
        })}
      </ul>
    </div>
  )
}
