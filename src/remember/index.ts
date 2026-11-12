import { onMessage, registerFeature, createStore } from '../core/bus'
import type { CoreCtx } from '../core/bus'
import { friendlyDeviceName } from './deviceName'
import { clearDeviceMeta } from './deviceMeta'
import {
  createRememberGrant,
  loadGuestStore,
  loadHostStore,
  phoneKeyStored,
  saveGuestStore,
  saveHostStore,
  upsertGuestLaptop,
  upsertHostPhone,
  forgetGuestLaptopRecord,
  forgetHostPhoneRecord,
  type SavedLaptop,
} from './storage'
import { guestForgetShouldSync } from './guestForgetSync'

export const rememberPrompt = createStore(false)

registerFeature({
  id: 'remember',
  title: 'Remember',
  icon: 'link',
  order: 999,
  init(ctx) {
    const off: (() => void)[] = []
    off.push(onMessage('remember:ask', (_m, c) => {
      if (c.role !== 'host' || !c.link.connected) return
      rememberPrompt.set(true)
    }))
    off.push(onMessage('remember:grant', (m, c) => {
      if (c.role !== 'guest') return
      const listenId = String(m.listenId ?? '')
      const phoneId = String(m.phoneId ?? '')
      const key = String(m.key ?? '')
      const laptopName = String(m.laptopName ?? 'Laptop')
      if (!listenId || !phoneId || !key) return
      const store = upsertGuestLaptop(loadGuestStore(), {
        listenId,
        phoneId,
        name: laptopName,
        key,
      })
      saveGuestStore(store)
      c.send({ t: 'remember:name', name: friendlyDeviceName(), phoneId })
      c.toast('Laptop remembered')
    }))
    off.push(onMessage('remember:name', (m, c) => {
      if (c.role !== 'host') return
      const phoneId = String(m.phoneId ?? '')
      const name = String(m.name ?? '')
      if (!phoneId || !name) return
      const store = loadHostStore()
      if (!store) return
      const phones = store.phones.map((p) => (p.id === phoneId ? { ...p, name } : p))
      saveHostStore({ ...store, phones })
      c.link.refreshRememberListen()
    }))
    return () => { off.forEach((f) => f()); rememberPrompt.set(false) }
  },
})

export function allowRemember(ctx: CoreCtx) {
  rememberPrompt.set(false)
  const prev = loadHostStore()
  const grant = createRememberGrant(prev?.listenId)
  const store = upsertHostPhone(prev, {
    id: grant.phoneId,
    name: '…',
    key: phoneKeyStored(grant.key),
  })
  saveHostStore(store)
  ctx.send({
    t: 'remember:grant',
    listenId: store.listenId,
    phoneId: grant.phoneId,
    key: phoneKeyStored(grant.key),
    laptopName: grant.laptopName,
  })
  ctx.link.clearRememberListenGiveUp()
  ctx.link.refreshRememberListen()
}

export function denyRemember() {
  rememberPrompt.set(false)
}

export function forgetHostPhone(ctx: CoreCtx, phoneId: string) {
  clearDeviceMeta(phoneId)
  const store = loadHostStore()
  if (!store) return
  if (ctx.link.connected) {
    try {
      ctx.send({ t: 'remember:forget', listenId: store.listenId, phoneId })
    } catch {}
  }
  const { next, stopListen } = forgetHostPhoneRecord(store, phoneId)
  saveHostStore(next)
  ctx.link.refreshRememberListen(stopListen)
}

export function forgetGuestLaptopLocal(listenId: string) {
  saveGuestStore(forgetGuestLaptopRecord(loadGuestStore(), listenId))
  clearDeviceMeta(listenId)
}

export function forgetGuestLaptop(ctx: CoreCtx, listenId: string) {
  const store = loadGuestStore()
  const lap = store.laptops.find((l) => l.listenId === listenId)
  if (
    lap
    && guestForgetShouldSync(
      ctx.link.connected,
      ctx.link.rememberListenId,
      ctx.link.guestSessionPaired,
      lap,
      store.laptops.length,
    )
  ) {
    try {
      ctx.send({ t: 'remember:forget', phoneId: lap.phoneId, listenId: lap.listenId })
    } catch {}
  }
  forgetGuestLaptopLocal(listenId)
}

export type { SavedLaptop } from './storage'
