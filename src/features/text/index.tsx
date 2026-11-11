// Feature 2: text + links both ways. Messages: text:msg
import React, { useState } from 'react'
import { createStore, registerFeature, onMessage, CoreCtx } from '../../core/bus'
import { Icon } from '../../core/icons'
import { CopyBtn, Linkified } from '../../core/ui'
import { ago, uid } from '../../core/util'

export type TextItem = { id: string; dir: 'in' | 'out'; text: string; ts: number }
export const texts = createStore<TextItem[]>([])

export function sendText(ctx: CoreCtx, text: string) {
  if (!text.trim()) return
  const id = uid(); ctx.send({ t: 'text:msg', id, text })
  texts.set((xs) => [{ id, dir: 'out', text, ts: Date.now() }, ...xs])
}

function Row({ it, ctx }: { it: TextItem; ctx: CoreCtx }) {
  return <div className="row" data-testid={`item-${it.dir}-text`}>
    <i className="ri"><Icon n={/https?:\/\/|www\./.test(it.text) ? 'link' : 'clip'} /></i>
    <div className="grow"><div className="txt"><Linkified text={it.text} /></div><small>{it.dir === 'in' ? 'Received' : 'Sent'} · {ago(it.ts)}</small></div>
    <CopyBtn text={it.text} ctx={ctx} />
  </div>
}

function LaptopPanel({ ctx }: { ctx: CoreCtx }) {
  const [t, setT] = useState('')
  const list = texts.use()
  return <div className="card pad">
    <h3>Send text or link</h3>
    <form className="send" onSubmit={(e) => { e.preventDefault(); sendText(ctx, t); setT('') }}>
      <input data-testid="text-input" value={t} onChange={(e) => setT(e.target.value)} placeholder="Paste a link or type a note…" />
      <button className="btn" data-testid="text-send" disabled={!t.trim()}><Icon n="send" />Send</button>
    </form>
    {list.length > 0 && <div className="list" style={{ marginTop: 10 }}>{list.map((it) => <Row key={it.id} it={it} ctx={ctx} />)}</div>}
  </div>
}

function PhonePage({ ctx }: { ctx: CoreCtx }) {
  const [t, setT] = useState('')
  const list = texts.use()
  return <div className="pg">
    <form className="stack" onSubmit={(e) => { e.preventDefault(); sendText(ctx, t); setT('') }}>
      <textarea data-testid="phone-text-input" className="clip" rows={3} value={t} onChange={(e) => setT(e.target.value)} placeholder="Type a note or paste a link" />
      <button className="btn big" data-testid="phone-text-send" disabled={!t.trim()}><Icon n="send" />Send to laptop</button>
    </form>
    <h3 className="sec">Messages</h3>
    {list.length ? <div className="list">{list.map((it) => <Row key={it.id} it={it} ctx={ctx} />)}</div> : <p className="mut small">Nothing yet.</p>}
  </div>
}

registerFeature({
  id: 'text', title: 'Text / link', icon: 'link', order: 20, laptopColumn: 'left', LaptopPanel, PhonePage,
  init: (ctx) => onMessage('text:msg', (m) => { texts.set((xs) => [{ id: m.id, dir: 'in', text: m.text, ts: Date.now() }, ...xs]); ctx.toast('New message received') }),
})
