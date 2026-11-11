// Feature 2: text + links both ways. Messages: text:msg
import React, { useEffect, useRef, useState } from 'react'
import { createStore, registerFeature, onMessage, CoreCtx } from '../../core/bus'
import { Icon } from '../../core/icons'
import { ago, copyText, uid } from '../../core/util'
import { MAX_TEXT, addTextItem, firstSafeLink, isSafeHttpUrl, linkDomain, linkParts, openHrefFor, prepareText, previewText } from './logic'
import './text.css'

export type TextItem = { id: string; dir: 'in' | 'out'; text: string; ts: number }
export const texts = createStore<TextItem[]>([])

export function sendText(ctx: CoreCtx, text: string) {
  const prepared = prepareText(text)
  if (!prepared || !ctx.link.connected) return
  const id = uid()
  ctx.send({ t: 'text:msg', id, text: prepared.text })
  const prev = texts.get()
  const item: TextItem = { id, dir: 'out', text: prepared.text, ts: Date.now() }
  const next = addTextItem(prev, item)
  if (next !== prev) texts.set(next)
}

let viewing = false
let unread = 0
let incomingUi: IncomingUi | null = null

function useTextPage() {
  useEffect(() => {
    viewing = true
    unread = 0
    incomingUi?.hide()
    return () => { viewing = false }
  }, [])
}

function receiveText(m: { id?: unknown; text?: unknown } | null, ctx: CoreCtx) {
  if (!m || typeof m.text !== 'string') return
  const prepared = prepareText(m.text)
  if (!prepared) return
  const id = typeof m.id === 'string' && m.id ? m.id : uid()
  const prev = texts.get()
  const item: TextItem = { id, dir: 'in', text: prepared.text, ts: Date.now() }
  const next = addTextItem(prev, item)
  if (next === prev) return
  texts.set(next)
  if (viewing) return
  const preview = previewText(prepared.text)
  if (ctx.role === 'guest') {
    unread += 1
    incomingUi?.show(preview, unread)
  } else {
    ctx.toast(preview ? `New message: ${preview}` : 'New message')
  }
}

function removeText(id: string) {
  texts.set(texts.get().filter((x) => x.id !== id))
}

function TextBody({ text }: { text: string }) {
  const parts = linkParts(text)
  return <>{parts.map((p, i) => (
    p.type === 'link' && isSafeHttpUrl(p.href)
      ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">{p.value}</a>
      : <React.Fragment key={i}>{p.value}</React.Fragment>
  ))}</>
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
}

function flashCopy(text: string, ctx: CoreCtx, setDone: (v: boolean) => void, timer: React.MutableRefObject<number>) {
  return copyText(text).then((ok) => {
    ctx.toast(ok ? 'Copied' : 'Copy blocked by browser')
    if (!ok) return
    setDone(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDone(false), 1500)
  })
}

function CopyTick({ text, ctx, done, onDone }: { text: string; ctx: CoreCtx; done?: boolean; onDone?: (v: boolean) => void }) {
  const [local, setLocal] = useState(false)
  const timer = useRef(0)
  const on = done ?? local
  const setDone = onDone ?? setLocal
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return <button
    type="button"
    className={'iconbtn sm' + (on ? ' text-copied' : '')}
    aria-label={on ? 'Copied' : 'Copy'}
    onClick={(e) => { e.stopPropagation(); void flashCopy(text, ctx, setDone, timer) }}
  >{on ? <CheckIcon /> : <Icon n="copy" />}</button>
}

function DomainLine({ href }: { href: string }) {
  const domain = linkDomain(href)
  const [ok, setOk] = useState(false)
  if (!domain) return null
  return <span className="text-domain">
    {ok
      ? <img alt="" width={14} height={14} src={`https://${domain}/favicon.ico`} />
      : <Icon n="link" />}
    <img alt="" hidden src={`https://${domain}/favicon.ico`} onLoad={() => setOk(true)} onError={() => setOk(false)} />
    {domain}
  </span>
}

function useHold(onHold: () => void, onTap: () => void) {
  const timer = useRef(0)
  const held = useRef(false)
  const origin = useRef({ x: 0, y: 0 })
  const clear = () => { window.clearTimeout(timer.current); timer.current = 0 }
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('a,button')) return
      held.current = false
      origin.current = { x: e.clientX, y: e.clientY }
      clear()
      timer.current = window.setTimeout(() => { held.current = true; onHold() }, 600)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!timer.current) return
      if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 10) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest('a,button')) return
      if (held.current) { held.current = false; return }
      if (window.getSelection()?.toString()) return
      onTap()
    },
  }
}

function Notice({ draft, notice }: { draft: string; notice: string }) {
  const over = draft.trim().length > MAX_TEXT
  const text = over ? 'Limit is 10,000 characters.' : notice
  if (!text) return null
  return <p className="text-note" role="status" data-testid="text-notice">{text}</p>
}

function useComposer(ctx: CoreCtx) {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const send = () => {
    const prepared = prepareText(draft)
    if (!prepared) return false
    if (!ctx.link.connected) { ctx.toast('Not connected'); return false }
    sendText(ctx, draft)
    setDraft('')
    setNotice(prepared.capped ? 'Shortened to 10,000 characters.' : '')
    return true
  }
  const onChange = (value: string) => { setDraft(value); setNotice('') }
  const paste = async (box: HTMLTextAreaElement | null) => {
    try {
      const clip = await navigator.clipboard.readText()
      if (!clip) { ctx.toast('Clipboard is empty'); return }
      const start = box?.selectionStart ?? draft.length
      const end = box?.selectionEnd ?? start
      const next = draft.slice(0, start) + clip + draft.slice(end)
      setDraft(next)
      setNotice('')
      requestAnimationFrame(() => {
        box?.focus()
        const pos = start + clip.length
        box?.setSelectionRange(pos, pos)
      })
    } catch {
      ctx.toast('Allow clipboard access, or paste into the box')
    }
  }
  return { draft, notice, send, onChange, paste }
}

function fitBox(el: HTMLTextAreaElement | null, max: number) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, max)}px`
}

function LaptopRow({ it, ctx }: { it: TextItem; ctx: CoreCtx }) {
  const href = firstSafeLink(it.text)
  const safe = href && isSafeHttpUrl(href) ? href : ''
  const hold = useHold(() => { removeText(it.id); ctx.toast('Message removed') }, () => {})
  return <div className="row text-row" data-testid={`item-${it.dir}-text`} {...hold}>
    <div className="grow">
      <div className="txt text-clamp"><TextBody text={it.text} /></div>
      {safe && <DomainLine href={safe} />}
      {it.dir === 'in'
        ? <small>From phone · {ago(it.ts)}</small>
        : <span className="text-sent">Sent</span>}
    </div>
    <div className="text-actions">
      {safe && <a className="text-open" data-testid="text-open" href={safe} target="_blank" rel="noopener noreferrer" aria-label={`Open ${safe}`}>Open</a>}
      <CopyTick text={it.text} ctx={ctx} />
    </div>
  </div>
}

function LaptopPanel({ ctx }: { ctx: CoreCtx }) {
  useTextPage()
  const list = texts.use()
  const box = useRef<HTMLTextAreaElement>(null)
  const { draft, notice, send, onChange, paste } = useComposer(ctx)
  useEffect(() => { fitBox(box.current, 110) }, [draft])
  const submit = () => { send(); box.current?.focus() }
  const ready = !!draft.trim()
  return <div className="card pad text-card">
    <h3>Send text or link</h3>
    <form onSubmit={(e) => { e.preventDefault(); submit() }}>
      <label className="text-sr" htmlFor="text-input">Paste a link or type a note</label>
      <div className="text-compose">
        <textarea
          id="text-input"
          ref={box}
          data-testid="text-input"
          rows={1}
          value={draft}
          placeholder="Paste a link or type a note…"
          enterKeyHint="send"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button className="btn text-send" type="submit" data-testid="text-send" disabled={!ready}><Icon n="send" />Send</button>
      </div>
      <Notice draft={draft} notice={notice} />
    </form>
    <div className="text-extra">
      <button type="button" className="chip" onClick={() => paste(box.current)}><Icon n="clip" />Paste from clipboard</button>
    </div>
    {list.length > 0 && <div className="h-row text-list-hd">
      <h3>Messages</h3>
      <button type="button" className="text-clear" data-testid="text-clear" aria-label="Clear messages" onClick={() => texts.set([])}>Clear</button>
    </div>}
    <div className="list" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages">
      {list.length === 0
        ? <p className="mut small text-empty">Nothing yet. Text you send or receive shows up here.</p>
        : list.map((it) => <LaptopRow key={it.id} it={it} ctx={ctx} />)}
    </div>
  </div>
}

function PhoneBubble({ it, ctx }: { it: TextItem; ctx: CoreCtx }) {
  const mine = it.dir === 'out'
  const href = !mine ? openHrefFor(it.dir, it.text) : ''
  const safe = href && isSafeHttpUrl(href) ? href : ''
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const hold = useHold(() => { removeText(it.id); ctx.toast('Message removed') }, () => { void flashCopy(it.text, ctx, setCopied, timer) })
  return <div className={'text-bubble ' + (mine ? 'mine' : 'theirs')} data-testid={`item-${it.dir}-text`} {...hold}>
    <div className="txt"><TextBody text={it.text} /></div>
    {safe && <DomainLine href={safe} />}
    <div className="text-bubble-meta">
      <small>{mine ? 'Sent' : `From laptop · ${ago(it.ts)}`}</small>
      <CopyTick text={it.text} ctx={ctx} done={copied} onDone={setCopied} />
    </div>
    {safe && <a className="btn text-open-link" data-testid="text-open" href={safe} target="_blank" rel="noopener noreferrer" aria-label={`Open link ${safe}`}>Open link</a>}
  </div>
}

function PhonePage({ ctx }: { ctx: CoreCtx }) {
  useTextPage()
  const list = texts.use()
  const box = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const { draft, notice, send, onChange, paste } = useComposer(ctx)
  const chat = [...list].reverse()
  useEffect(() => { fitBox(box.current, 120) }, [draft])
  useEffect(() => {
    const el = root.current
    const apply = () => {
      const vv = window.visualViewport
      const inset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0
      el?.style.setProperty('--text-kb', `${inset}px`)
      el?.classList.toggle('kb-open', inset > 0)
      end.current?.scrollIntoView({ block: 'end' })
    }
    apply()
    window.visualViewport?.addEventListener('resize', apply)
    window.visualViewport?.addEventListener('scroll', apply)
    window.addEventListener('resize', apply)
    return () => {
      window.visualViewport?.removeEventListener('resize', apply)
      window.visualViewport?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
    }
  }, [])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [list.length])
  const submit = () => { send(); box.current?.focus() }
  const ready = !!draft.trim()
  return <div className="text-phone" ref={root}>
    {list.length > 0 && <div className="text-phone-tools">
      <button type="button" className="text-clear" data-testid="text-clear" aria-label="Clear messages" onClick={() => texts.set([])}>Clear</button>
    </div>}
    <div className="text-chat" role="log" aria-live="polite" aria-relevant="additions" aria-label="Messages">
      {chat.length === 0
        ? <p className="mut small text-empty">Nothing yet. Text you send or receive shows up here.</p>
        : chat.map((it) => <PhoneBubble key={it.id} it={it} ctx={ctx} />)}
      <div className="text-end" ref={end} />
    </div>
    <form className="text-dock" onSubmit={(e) => { e.preventDefault(); submit() }}>
      <Notice draft={draft} notice={notice} />
      <div className="text-dock-row">
        <button type="button" className="text-icon" aria-label="Paste" onClick={() => paste(box.current)}><Icon n="clip" /></button>
        <label className="text-sr" htmlFor="phone-text-input">Message</label>
        <textarea
          id="phone-text-input"
          ref={box}
          data-testid="phone-text-input"
          rows={1}
          value={draft}
          placeholder="Message"
          enterKeyHint="enter"
          onChange={(e) => onChange(e.target.value)}
        />
        <button className="btn text-round" type="submit" data-testid="phone-text-send" aria-label="Send" disabled={!ready}><Icon n="send" /></button>
      </div>
    </form>
  </div>
}

type IncomingUi = { show: (preview: string, count: number) => void; hide: () => void; destroy: () => void }

function createIncomingUi(ctx: CoreCtx): IncomingUi {
  const live = document.createElement('div')
  live.className = 'text-incoming'
  live.setAttribute('aria-live', 'polite')
  live.setAttribute('aria-relevant', 'additions')
  document.body.appendChild(live)

  let toast: HTMLButtonElement | null = null
  let dot: HTMLButtonElement | null = null
  let timer = 0
  let poll = 0
  let frame = 0
  let observer: MutationObserver | null = null

  const open = () => {
    unread = 0
    hide()
    ctx.openPage('text')
  }

  const placeDot = () => {
    if (!dot) return
    const tile = document.querySelector('[data-testid="tile-text"]')
    if (!(tile instanceof HTMLElement)) { dot.classList.remove('is-on'); return }
    const r = tile.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) { dot.classList.remove('is-on'); return }
    dot.classList.add('is-on')
    dot.style.top = `${Math.round(r.top + 10)}px`
    dot.style.left = `${Math.round(r.right - 22)}px`
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(placeDot)
  }

  const hide = () => {
    window.clearTimeout(timer)
    window.clearInterval(poll)
    cancelAnimationFrame(frame)
    toast?.remove()
    toast = null
    dot?.remove()
    dot = null
    observer?.disconnect()
    observer = null
    window.removeEventListener('resize', schedule)
    window.removeEventListener('scroll', schedule, true)
  }

  const show = (_preview: string, count: number) => {
    if (viewing) return
    if (!dot) {
      dot = document.createElement('button')
      dot.type = 'button'
      dot.className = 'text-tile-dot'
      dot.dataset.testid = 'text-dot'
      dot.addEventListener('click', open)
      document.body.appendChild(dot)
      window.addEventListener('resize', schedule)
      window.addEventListener('scroll', schedule, true)
      observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })
      window.clearInterval(poll)
      poll = window.setInterval(schedule, 400)
    }
    dot.setAttribute('aria-label', count > 1 ? `${count} new messages` : 'New message')
    schedule()

    toast?.remove()
    toast = document.createElement('button')
    toast.type = 'button'
    toast.className = 'text-toast'
    toast.dataset.testid = 'text-toast'
    toast.textContent = 'New message'
    toast.setAttribute('aria-label', 'New message. Open text')
    toast.addEventListener('click', open)
    live.appendChild(toast)
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { toast?.remove(); toast = null }, 4200)
  }

  return {
    show,
    hide,
    destroy() { hide(); live.remove() },
  }
}

registerFeature({
  id: 'text', title: 'Text / link', icon: 'link', order: 20, laptopColumn: 'left', LaptopPanel, PhonePage,
  init: (ctx) => {
    incomingUi?.destroy()
    unread = 0
    incomingUi = ctx.role === 'guest' ? createIncomingUi(ctx) : null
    const off = onMessage('text:msg', (m) => receiveText(m, ctx))
    return () => {
      off()
      incomingUi?.destroy()
      incomingUi = null
      unread = 0
    }
  },
})
