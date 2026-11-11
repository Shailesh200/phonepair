/**
 * PhonePair core message bus + feature registry.
 *
 * Every feature lives in src/features/<area>/ and calls registerFeature() once
 * (imported from src/features/index.ts). Features talk to the other device only
 * through this bus: send({ t: 'myarea:thing', ... }) and onMessage('myarea:thing', fn).
 * Use a prefix per area for message types ('text:', 'file:', 'clip:', 'remote:', 'cam:', 'screen:').
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { MediaConnection } from 'peerjs'
import type { Link } from './link'
import type React from 'react'

export type Msg = { t: string; [k: string]: unknown }
export type Role = 'host' | 'guest'

/** What every feature gets: the live link plus helpers. `role` is 'host' on the laptop, 'guest' on the phone. */
export type CoreCtx = {
  role: Role
  link: Link
  send: (m: Msg) => void
  /** start a one-way media stream to the other device; receiver gets it via onCall(kind) */
  call: (stream: MediaStream, kind: string) => MediaConnection
  toast: (text: string) => void
  /** phone only: open a feature page by feature id (e.g. when a screen stream arrives) */
  openPage: (featureId: string) => void
}

export type Feature = {
  id: string // 'text', 'files', ...
  title: string // tile + page title
  icon: string // icon name from core/icons.tsx
  order?: number // lower = earlier (tiles + panels)
  /** phone: home-screen tile opens this full page */
  PhonePage?: React.FC<{ ctx: CoreCtx }>
  /** laptop dashboard: card in the left or right column */
  LaptopPanel?: React.FC<{ ctx: CoreCtx }>
  laptopColumn?: 'left' | 'right'
  /** laptop: full-screen layer above the dashboard (pointer, slideshow, …) */
  LaptopOverlay?: React.FC<{ ctx: CoreCtx }>
  /** runs once per device when the link is created; register message/call handlers here. Return cleanup. */
  init?: (ctx: CoreCtx) => void | (() => void)
}

const features: Feature[] = []
export function registerFeature(f: Feature) {
  if (features.some((x) => x.id === f.id)) return
  features.push(f)
  features.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}
export const getFeatures = () => features

// ---- message routing ----
type Handler = (m: any, ctx: CoreCtx) => void
const handlers = new Map<string, Set<Handler>>()
/** Subscribe to a message type for the lifetime of the app (call from init). Returns unsubscribe. */
export function onMessage(type: string, h: Handler) {
  let s = handlers.get(type); if (!s) handlers.set(type, (s = new Set()))
  s.add(h); return () => { s!.delete(h) }
}
/** Same as onMessage but tied to a React component's lifetime. */
export function useMessage(type: string, h: Handler, deps: unknown[] = []) {
  useEffect(() => onMessage(type, h), deps) // eslint-disable-line react-hooks/exhaustive-deps
}
export function dispatch(m: Msg, ctx: CoreCtx) {
  handlers.get(m.t)?.forEach((h) => { try { h(m, ctx) } catch (e) { console.error('handler failed for', m.t, e) } })
  handlers.get('*')?.forEach((h) => h(m, ctx))
}

// ---- incoming media calls, routed by metadata.kind ----
type CallHandler = (call: MediaConnection, ctx: CoreCtx) => void
const callHandlers = new Map<string, CallHandler>()
export function onCall(kind: string, h: CallHandler) { callHandlers.set(kind, h); return () => { if (callHandlers.get(kind) === h) callHandlers.delete(kind) } }
export function dispatchCall(call: MediaConnection, ctx: CoreCtx) {
  const h = callHandlers.get(call.metadata?.kind)
  if (h) h(call, ctx); else call.close()
}

// ---- tiny global stores so feature state survives page changes ----
export function createStore<T>(initial: T) {
  let v = initial
  const subs = new Set<() => void>()
  const get = () => v
  const set = (n: T | ((p: T) => T)) => { v = typeof n === 'function' ? (n as (p: T) => T)(v) : n; subs.forEach((s) => s()) }
  const subscribe = (s: () => void) => { subs.add(s); return () => { subs.delete(s) } }
  const use = () => useSyncExternalStore(subscribe, get, get)
  return { get, set, subscribe, use }
}
