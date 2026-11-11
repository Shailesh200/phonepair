import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { Link, newCode, cleanCode, isPhoneUA } from './core/link'
import { entryPath, hostEntryPath, joinPath, syncRelayFromUrl } from './features/pairing/relay'
import { CoreCtx, Role, dispatch, dispatchCall, getFeatures } from './core/bus'
import { uid } from './core/util'
import { Laptop } from './Laptop'
import { Phone, PhoneEntry } from './Phone'
import './features'

function routeInfo(): { role: Role | null; code: string } {
  syncRelayFromUrl()
  const m = location.pathname.match(/^\/j\/([A-Za-z0-9]{6})/)
  const q = new URLSearchParams(location.search)
  const c = m?.[1] || q.get('c')
  if (c) return { role: 'guest', code: cleanCode(c) }
  if (q.get('as') === 'host') return { role: 'host', code: '' }
  if (isPhoneUA()) return { role: null, code: '' }
  return { role: 'host', code: '' }
}

export default function App() {
  const [route, setRoute] = useState(routeInfo)
  const [link, setLink] = useState<Link | null>(null)
  const [, force] = useReducer((x: number) => x + 1, 0)
  const [toasts, setToasts] = useState<{ id: string; t: string }[]>([])
  const [page, setPage] = useState('home')

  const toast = useCallback((t: string) => {
    const id = uid(); setToasts((x) => [...x, { id, t }]); setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 3200)
  }, [])

  useEffect(() => {
    if (!route.role) return
    let code = route.code
    if (route.role === 'host') { code = sessionStorage.getItem('pp-code') || newCode(); sessionStorage.setItem('pp-code', code) }
    const l = new Link(route.role, code)
    setLink(l)
    const unsub = l.subscribe(force)
    l.start()
    ;(window as any).__pp = l
    const bye = () => l.destroy()
    window.addEventListener('pagehide', bye)
    return () => { unsub(); window.removeEventListener('pagehide', bye); l.destroy() }
  }, [route])

  const ctx = useMemo<CoreCtx | null>(() => link && route.role ? {
    role: route.role, link, toast,
    send: (m) => link.send(m),
    call: (stream, kind) => link.call(stream, kind),
    openPage: (id) => { if (id !== 'home') history.pushState({ p: id }, ''); setPage(id) },
  } : null, [link, route.role, toast])

  // wire the bus + run each feature's init once per link
  useEffect(() => {
    if (!ctx) return
    const offM = ctx.link.onMessage((m) => dispatch(m, ctx))
    const offC = ctx.link.onCall((c) => dispatchCall(c, ctx))
    const cleanups = getFeatures().map((f) => f.init?.(ctx))
    return () => { offM(); offC(); cleanups.forEach((c) => typeof c === 'function' && c()) }
  }, [ctx])

  const toastsEl = <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.t}</div>)}</div>
  if (!route.role) return <><PhoneEntry onCode={(c) => { const path = joinPath(c); syncRelayFromUrl(); history.pushState(null, '', path); setRoute({ role: 'guest', code: cleanCode(c) }) }} onHost={() => { syncRelayFromUrl(); history.pushState(null, '', hostEntryPath()); setRoute({ role: 'host', code: '' }) }} />{toastsEl}</>
  if (!ctx) return null
  return <>{route.role === 'host' ? <Laptop ctx={ctx} /> : <Phone ctx={ctx} page={page} setPage={setPage} onLeave={() => { ctx.link.disconnect(); history.pushState(null, '', entryPath()); setRoute({ role: null, code: '' }) }} />}{toastsEl}</>
}
