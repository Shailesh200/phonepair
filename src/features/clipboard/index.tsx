// Feature 4: live clipboard with history. Messages: clip:set
import React, { useEffect } from 'react'
import { createStore, registerFeature, onMessage, CoreCtx } from '../../core/bus'
import { Icon } from '../../core/icons'
import { CopyBtn, Linkified } from '../../core/ui'
import { ago, uid } from '../../core/util'

type Entry = { id: string; text: string; from: 'me' | 'them'; ts: number }
export const clip = createStore('')
export const history = createStore<Entry[]>([])
const addHist = (text: string, from: 'me' | 'them') => { if (text.trim()) history.set((h) => (h[0]?.text === text ? h : [{ id: uid(), text, from, ts: Date.now() }, ...h.filter((e) => e.text !== text)].slice(0, 20))) }
let commit: number | undefined
function setLocal(ctx: CoreCtx, t: string) {
  clip.set(t); ctx.send({ t: 'clip:set', text: t })
  window.clearTimeout(commit); commit = window.setTimeout(() => addHist(t, 'me'), 1200)
}
const pasteBtn = (ctx: CoreCtx) => async () => { try { setLocal(ctx, await navigator.clipboard.readText()) } catch { ctx.toast('Allow clipboard access, or paste into the box') } }

function History({ ctx, me }: { ctx: CoreCtx; me: string }) {
  const h = history.use()
  return <div className="list hist">{h.map((e) => <div className="row" key={e.id}><i className="ri"><Icon n="clip" /></i><div className="grow"><div className="txt"><Linkified text={e.text} /></div><small>{e.from === 'me' ? me : ctx.link.remoteName || 'Other device'} · {ago(e.ts)}</small></div><CopyBtn text={e.text} ctx={ctx} /></div>)}</div>
}

function LaptopPanel({ ctx }: { ctx: CoreCtx }) {
  const v = clip.use()
  return <div className="card pad">
    <h3 className="h-row"><span><Icon n="clip" /> Live clipboard</span><span className="sync">● Syncing</span></h3>
    <textarea data-testid="clip-box" className="clip" value={v} onChange={(e) => setLocal(ctx, e.target.value)} placeholder="Type or paste here and it appears on your phone instantly." rows={3} />
    <div className="row-g"><button className="btn ghost sm" onClick={pasteBtn(ctx)}>Paste from clipboard</button><CopyBtn text={v} ctx={ctx} label="Copy" /></div>
    <History ctx={ctx} me="This laptop" />
  </div>
}

function PhonePage({ ctx }: { ctx: CoreCtx }) {
  const v = clip.use()
  return <div className="pg">
    <p className="mut small">Anything typed or pasted here shows up on your laptop instantly, and the other way round.</p>
    <textarea data-testid="phone-clip-box" className="clip" rows={4} value={v} onChange={(e) => setLocal(ctx, e.target.value)} placeholder="Shared clipboard" />
    <div className="row-g"><button className="btn ghost" onClick={pasteBtn(ctx)}>Paste</button><CopyBtn text={v} ctx={ctx} label="Copy" /></div>
    <h3 className="sec">History</h3>
    <History ctx={ctx} me="This phone" />
  </div>
}

registerFeature({
  id: 'clipboard', title: 'Clipboard', icon: 'clip', order: 30, laptopColumn: 'right', LaptopPanel, PhonePage,
  init: () => onMessage('clip:set', (m) => { clip.set(m.text); addHist(m.text, 'them') }),
})
