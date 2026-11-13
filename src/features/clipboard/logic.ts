// Live clipboard: history rows, permission checks, and copy/paste fallbacks.
import { createStore } from '../../core/bus'
import { uid } from '../../core/util'
import { notifyPair } from '../session/client'

export type Device = 'phone' | 'laptop'
export type Entry = { id: string; text: string; device: Device; ts: number }
export type SendCtx = { role: 'host' | 'guest'; send: (m: ClipMsg) => void }
export type ClipMsg = { t: 'clip:set'; text: string; commit: boolean; ts?: number; device: Device }

export const CLIP_READ_BLOCKED = 'Clipboard reading is blocked in this browser (including iOS Safari). Paste into the box and press Send.'
export const COMMIT_MS = 800

export const clip = createStore('')
export const history = createStore<Entry[]>([])

type ClipNav = {
  clipboard?: {
    readText?: () => Promise<string>
    writeText?: (text: string) => Promise<void>
  }
  permissions?: { query?: (desc: { name: string }) => Promise<{ state?: string }> }
}

export type ReadResult = { ok: true; text: string } | { ok: false; fallback: true; message: string }

let timer: ReturnType<typeof setTimeout> | undefined

export function clearClipTimer() {
  if (timer !== undefined) { clearTimeout(timer); timer = undefined }
}

export function resetClipboard() {
  clearClipTimer()
  clip.set('')
  history.set([])
}

export function deviceFor(role: 'host' | 'guest', from: 'me' | 'them'): Device {
  const mine: Device = role === 'host' ? 'laptop' : 'phone'
  return from === 'me' ? mine : mine === 'laptop' ? 'phone' : 'laptop'
}

export function clipType(text: string): string {
  const t = text.trim()
  if (/(?:^|[\s(])(?:https?:\/\/|www\.)?(?:[\w-]+\.)*(?:zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|gotomeeting\.com|whereby\.com|meet\.jit\.si)\b/i.test(t)) return 'Meeting link'
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return 'Email'
  const digits = t.replace(/\D/g, '')
  if (/^\+?[\d\s().-]{7,}$/.test(t) && digits.length >= 7) return 'Phone number'
  if (/^(https?:\/\/|www\.)\S+$/i.test(t) || /\bhttps?:\/\/\S+/i.test(t)) return 'Link'
  return 'Text'
}

export function clipAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function clipMeta(text: string, ts: number, now = Date.now()) {
  return `${clipType(text)} · ${clipAgo(ts, now)}`
}

export function pushHistory(list: Entry[], text: string, device: Device, ts: number): Entry[] {
  if (!text.trim()) return list
  if (list[0]?.text === text) return list
  return [{ id: uid(), text, device, ts }, ...list.filter((e) => e.text !== text)].slice(0, 20)
}

export function editClip(ctx: SendCtx, text: string) {
  const device = deviceFor(ctx.role, 'me')
  clip.set(text)
  ctx.send({ t: 'clip:set', text, commit: false, device })
  clearClipTimer()
  timer = setTimeout(() => { if (clip.get() === text) commitClip(ctx, text) }, COMMIT_MS)
}

export function commitClip(ctx: SendCtx, text: string) {
  clearClipTimer()
  const device = deviceFor(ctx.role, 'me')
  const ts = Date.now()
  clip.set(text)
  if (!text.trim()) { ctx.send({ t: 'clip:set', text, commit: false, device }); return }
  ctx.send({ t: 'clip:set', text, commit: true, ts, device })
  const code = (ctx as { link?: { code?: string } }).link?.code
  if (code) void notifyPair(code, 'Clipboard', 'New clipboard text')
  history.set((h) => pushHistory(h, text, device, ts))
}

export function applyClipMessage(msg: { text?: unknown; commit?: unknown; ts?: unknown; device?: unknown }, role: 'host' | 'guest') {
  if (typeof msg.text !== 'string') return
  clearClipTimer()
  clip.set(msg.text)
  if (!msg.commit || !msg.text.trim()) return
  const device: Device = msg.device === 'phone' || msg.device === 'laptop' ? msg.device : deviceFor(role, 'them')
  const ts = typeof msg.ts === 'number' ? msg.ts : Date.now()
  history.set((h) => pushHistory(h, msg.text as string, device, ts))
}

export function textFromPaste(data: { getData?: (type: string) => string } | null): string {
  if (!data?.getData) return ''
  return data.getData('text/plain') || ''
}

export function onComposerPaste(
  e: {
    preventDefault: () => void
    clipboardData: { getData: (type: string) => string } | null
    currentTarget: { selectionStart: number | null; selectionEnd: number | null }
  },
  current: string,
  commit: (text: string) => void,
) {
  const pasted = textFromPaste(e.clipboardData)
  if (!pasted) return
  const start = e.currentTarget.selectionStart ?? current.length
  const end = e.currentTarget.selectionEnd ?? current.length
  e.preventDefault()
  commit(current.slice(0, start) + pasted + current.slice(end))
}

function currentNav(): ClipNav | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator as ClipNav
}

export async function readSystemClipboard(nav?: ClipNav): Promise<ReadResult> {
  const n = nav ?? currentNav()
  const read = n?.clipboard?.readText
  if (typeof read !== 'function') return { ok: false, fallback: true, message: CLIP_READ_BLOCKED }
  try {
    const query = n?.permissions?.query
    if (typeof query === 'function') {
      try {
        const status = await query.call(n!.permissions, { name: 'clipboard-read' })
        if (status?.state === 'denied') return { ok: false, fallback: true, message: CLIP_READ_BLOCKED }
      } catch { /* Safari has no clipboard-read permission name; readText prompts or rejects. */ }
    }
    const text = await read.call(n!.clipboard)
    return { ok: true, text: typeof text === 'string' ? text : '' }
  } catch {
    return { ok: false, fallback: true, message: CLIP_READ_BLOCKED }
  }
}

export async function copyClip(text: string): Promise<boolean> {
  const nav = currentNav()
  const writer = nav?.clipboard?.writeText
  if (typeof writer === 'function') {
    try { await writer.call(nav!.clipboard, text); return true } catch { /* fall back to execCommand */ }
  }
  const doc = typeof document === 'undefined' ? undefined : document
  if (!doc?.body || typeof doc.createElement !== 'function' || typeof doc.execCommand !== 'function') return false
  const ta = doc.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.setAttribute('aria-hidden', 'true')
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '0'
  ta.style.opacity = '0'
  doc.body.appendChild(ta)
  try { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length) } catch { /* selection can fail on some browsers */ }
  let ok = false
  try { ok = doc.execCommand('copy') } catch { ok = false }
  ta.remove()
  return ok
}
