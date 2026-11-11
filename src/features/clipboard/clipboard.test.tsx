import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getFeatures, CoreCtx } from '../../core/bus'
import { ClipboardView, copyEntry } from './index'
import {
  CLIP_READ_BLOCKED, COMMIT_MS, applyClipMessage, clip, clipAgo, clipMeta, clipType, commitClip, copyClip, deviceFor, editClip, history, onComposerPaste, pushHistory, readSystemClipboard, resetClipboard,
} from './logic'

declare const __INDEX_SRC__: string
declare const __LOGIC_SRC__: string

function expect(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function ctx(role: 'host' | 'guest', send: (m: unknown) => void = () => {}): CoreCtx {
  return {
    role,
    link: { remoteName: 'Android phone' } as CoreCtx['link'],
    send: send as CoreCtx['send'],
    toast() {},
    call: (() => { throw new Error('unused') }) as CoreCtx['call'],
    openPage() {},
  }
}

function count(html: string, needle: string) {
  return html.split(needle).length - 1
}

export async function runClipboardTests() {
  expect(clipType('https://meet.google.com/abc-defg-hij') === 'Meeting link', 'meet link type')
  expect(clipType('https://us05web.zoom.us/j/123') === 'Meeting link', 'zoom link type')
  expect(clipType('https://teams.microsoft.com/l/meetup-join/abc') === 'Meeting link', 'teams link type')
  expect(clipType('https://example.com/notes') === 'Link', 'generic link type')
  expect(clipType('ada@example.com') === 'Email', 'email type')
  expect(clipType('+1 (415) 555-0134') === 'Phone number', 'phone type')
  expect(clipType('Standup notes') === 'Text', 'plain text type')
  const t0 = 1_700_000_000_000
  expect(clipAgo(t0, t0 + 120_000) === '2m ago', 'minutes ago')
  expect(clipAgo(t0, t0 + 4_000) === 'just now', 'just now')
  expect(clipMeta('https://meet.google.com/abc-defg-hij', t0, t0 + 120_000) === 'Meeting link · 2m ago', 'meta line')
  expect(deviceFor('host', 'me') === 'laptop' && deviceFor('host', 'them') === 'phone', 'laptop devices')
  expect(deviceFor('guest', 'me') === 'phone' && deviceFor('guest', 'them') === 'laptop', 'phone devices')

  let rows = pushHistory([], '   ', 'phone', 1)
  expect(rows.length === 0, 'blank text is not history')
  for (let i = 0; i < 25; i++) rows = pushHistory(rows, `item ${i}`, i % 2 ? 'phone' : 'laptop', i)
  expect(rows.length === 20 && rows[0].text === 'item 24' && rows[19].text === 'item 5', 'history keeps 20 newest')
  rows = pushHistory(rows, 'item 24', 'phone', 99)
  expect(rows[0].text === 'item 24' && rows[0].ts !== 99, 'top duplicate stays put')
  rows = pushHistory([{ id: 'b', text: 'keep', device: 'laptop', ts: 2 }, { id: 'a', text: 'old', device: 'phone', ts: 1 }], 'old', 'laptop', 3)
  expect(rows.length === 2 && rows[0].text === 'old' && rows[0].ts === 3 && rows[1].text === 'keep', 're-copy moves the row to the top')

  resetClipboard()
  const laptopSent: { text: string; commit: boolean; device: string; ts?: number }[] = []
  commitClip({ role: 'host', send: (m) => laptopSent.push(m) }, 'https://zoom.us/j/999')
  expect(laptopSent.length === 1 && laptopSent[0].commit === true && laptopSent[0].device === 'laptop', 'laptop commit sends')
  expect(history.get()[0]?.device === 'laptop' && history.get()[0]?.text.includes('zoom.us'), 'laptop history row')
  resetClipboard()
  applyClipMessage(laptopSent[0], 'guest')
  expect(clip.get().includes('zoom.us'), 'phone received the live text')
  expect(history.get()[0]?.device === 'laptop' && history.get()[0]?.text === laptopSent[0].text, 'phone shows the laptop row')

  resetClipboard()
  const phoneSent: { text: string; commit: boolean; device: string }[] = []
  commitClip({ role: 'guest', send: (m) => phoneSent.push(m) }, 'from the phone')
  expect(phoneSent[0].device === 'phone' && phoneSent[0].commit === true, 'phone commit sends')
  resetClipboard()
  applyClipMessage(phoneSent[0], 'host')
  expect(history.get()[0]?.device === 'phone' && history.get()[0]?.text === 'from the phone', 'laptop shows the phone row')

  resetClipboard()
  applyClipMessage({ text: 'partial', commit: false, device: 'phone' }, 'host')
  expect(clip.get() === 'partial' && history.get().length === 0, 'live keystrokes do not become history')
  applyClipMessage({ text: 12, commit: true }, 'host')
  expect(clip.get() === 'partial', 'non-string messages are ignored')

  resetClipboard()
  const typed: { commit: boolean; text: string; device: string }[] = []
  editClip({ role: 'guest', send: (m) => typed.push(m) }, 'note')
  expect(typed.length === 1 && typed[0].commit === false && typed[0].device === 'phone' && history.get().length === 0, 'typing syncs before it is committed')
  await delay(COMMIT_MS + 60)
  expect(typed.some((m) => m.commit && m.text === 'note'), 'paused typing is committed')
  expect(history.get()[0]?.text === 'note' && history.get()[0]?.device === 'phone', 'committed typing lands in history')
  resetClipboard()

  let committed: string = ''
  let prevented = false
  onComposerPaste({
    preventDefault() { prevented = true },
    clipboardData: { getData: (type) => type === 'text/plain' ? 'https://meet.google.com/abc-defg-hij' : '' },
    currentTarget: { selectionStart: 0, selectionEnd: 0 },
  }, '', (value) => { committed = value })
  expect(prevented && committed === 'https://meet.google.com/abc-defg-hij', 'paste event commits pasted text')
  onComposerPaste({
    preventDefault() {},
    clipboardData: { getData: () => 'X' },
    currentTarget: { selectionStart: 1, selectionEnd: 1 },
  }, 'ab', (value) => { committed = value })
  expect(committed === 'aXb', 'paste inserts at the caret')
  prevented = false
  let called = false
  onComposerPaste({
    preventDefault() { prevented = true },
    clipboardData: null,
    currentTarget: { selectionStart: 0, selectionEnd: 0 },
  }, 'ab', () => { called = true })
  expect(!prevented && !called, 'missing paste data leaves the event alone')

  const blocked = await readSystemClipboard({})
  expect(!blocked.ok && blocked.fallback && blocked.message === CLIP_READ_BLOCKED, 'missing readText uses the fallback')
  expect(/iOS Safari/.test(CLIP_READ_BLOCKED) && /Paste/.test(CLIP_READ_BLOCKED) && /Send/.test(CLIP_READ_BLOCKED), 'fallback message tells the user what to do')
  let reads = 0
  const denied = await readSystemClipboard({
    clipboard: { readText: async () => { reads++; return 'nope' } },
    permissions: { query: async () => ({ state: 'denied' }) },
  })
  expect(!denied.ok && reads === 0, 'denied permission does not read')
  const prompted = await readSystemClipboard({
    clipboard: { readText: async () => 'allowed text' },
    permissions: { query: async () => ({ state: 'prompt' }) },
  })
  expect(prompted.ok && prompted.text === 'allowed text', 'prompt state still calls readText')
  const safari = await readSystemClipboard({
    clipboard: { readText: async () => { throw new Error('NotAllowedError') } },
    permissions: { query: async () => { throw new Error('unsupported') } },
  })
  expect(!safari.ok && safari.message === CLIP_READ_BLOCKED, 'rejected readText uses the fallback')

  const prevClip = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const prevDoc = (globalThis as { document?: unknown }).document
  const ta: {
    value: string; tag: string; appended: boolean; removed: boolean
    style: { position?: string; left?: string; top?: string; opacity?: string }
    attrs: Record<string, string>
    setAttribute: (name: string, value: string) => void
    focus: () => void; select: () => void; setSelectionRange: () => void; remove: () => void
  } = {
    value: '', tag: '', appended: false, removed: false,
    style: {} as { position?: string; left?: string; top?: string; opacity?: string },
    attrs: {} as Record<string, string>,
    setAttribute(name: string, value: string) { this.attrs[name] = value },
    focus() {}, select() {}, setSelectionRange() {},
    remove() { this.removed = true },
  }
  let command = ''
  const restore = () => {
    if (prevClip) Object.defineProperty(navigator, 'clipboard', prevClip)
    else delete (navigator as { clipboard?: unknown }).clipboard
    if (prevDoc === undefined) delete (globalThis as { document?: unknown }).document
    else (globalThis as { document?: unknown }).document = prevDoc
  }
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { ta.value = `wrote:${text}` } } })
    expect(await copyClip('secret') === true && ta.value === 'wrote:secret', 'copy uses writeText when it works')
    let created = 0
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('NotAllowedError') } } })
    ;(globalThis as { document?: unknown }).document = {
      createElement(tag: string) { created++; ta.tag = tag; ta.value = ''; return ta },
      body: { appendChild() { ta.appended = true } },
      execCommand(name: string) { command = name; return true },
    }
    const notes: string[] = []
    expect(await copyEntry('hidden copy', (msg) => notes.push(msg)) === undefined, 'copy action returns')
    expect(notes[0] === 'Copied', 'copy action toasts Copied')
    expect(created === 1 && ta.tag === 'textarea' && ta.value === 'hidden copy', 'fallback copies through a hidden textarea')
    expect(ta.attrs['aria-hidden'] === 'true' && ta.style.position === 'fixed' && ta.style.left === '-9999px' && ta.style.opacity === '0', 'fallback textarea is hidden')
    expect(ta.appended && command === 'copy' && ta.removed, 'fallback runs execCommand(copy) and removes the textarea')
    ;(globalThis as { document?: unknown }).document = {
      createElement() { return ta },
      body: { appendChild() {} },
      execCommand() { return false },
    }
    const blockedNotes: string[] = []
    await copyEntry('nope', (msg) => blockedNotes.push(msg))
    expect(blockedNotes[0] === 'Copy blocked by browser', 'failed fallback tells the user')
  } finally { restore() }

  const now = Date.now()
  resetClipboard()
  clip.set('https://meet.google.com/abc-defg-hij')
  history.set([
    { id: 'row-phone', text: 'https://meet.google.com/abc-defg-hij', device: 'phone', ts: now - 120_000 },
    { id: 'row-laptop', text: 'Standup notes for the release', device: 'laptop', ts: now },
  ])
  const feature = getFeatures().find((f) => f.id === 'clipboard')
  expect(feature?.LaptopPanel && feature.PhonePage, 'clipboard feature is registered')
  const laptopHtml = renderToStaticMarkup(React.createElement(feature!.LaptopPanel!, { ctx: ctx('host') }))
  const phoneHtml = renderToStaticMarkup(React.createElement(feature!.PhonePage!, { ctx: ctx('guest') }))
  for (const html of [laptopHtml, phoneHtml]) {
    expect(html.includes('Meeting link · 2m ago'), 'row meta is type and time ago: ' + html)
    expect(html.includes('Text · just now'), 'plain row meta')
    expect(html.includes('https://meet.google.com/abc-defg-hij'), 'row shows the clip text')
    expect(html.includes('Standup notes for the release'), 'second row text')
    expect(html.includes('class="txt one"'), 'text is one line and ellipsized')
    expect(html.includes('data-testid="device-phone"') && html.includes('data-testid="device-laptop"'), 'phone and laptop icons')
    expect(count(html, 'data-testid="clip-copy"') === 2, 'one copy button per row')
    expect(html.includes('data-testid="clip-fallback"') && html.includes(CLIP_READ_BLOCKED), 'blocked read shows the fallback message')
    expect(html.includes('data-testid="clip-send"') && html.includes('>Send<'), 'fallback shows Send')
  }
  expect(laptopHtml.includes('data-testid="clip-box"'), 'laptop paste box')
  expect(phoneHtml.includes('data-testid="phone-clip-box"'), 'phone paste box')
  expect(laptopHtml.includes('data-testid="clip-sync"') && laptopHtml.includes('class="sync"') && laptopHtml.includes('Syncing'), 'green Syncing label')
  expect(!phoneHtml.includes('data-testid="clip-sync"'), 'phone view keeps the same rows without the laptop label')
  expect(laptopHtml.includes('Paste from clipboard') && phoneHtml.includes('>Paste<'), 'paste buttons')

  const openHtml = renderToStaticMarkup(<ClipboardView
    variant="laptop" value="hello" entries={history.get()} now={now} fallback={false} message=""
    onChange={() => {}} onPasteText={() => {}} onSend={() => {}} onPasteClick={() => {}} onCopy={() => {}}
  />)
  expect(!openHtml.includes('data-testid="clip-send"'), 'Send is only the blocked-clipboard fallback')
  expect(openHtml.includes('appears on your phone instantly'), 'type box stays above the list')
  expect(openHtml.includes('Meeting link · 2m ago') && openHtml.includes('class="txt one"'), 'open clipboard still renders history rows')

  expect(__INDEX_SRC__.includes('onComposerPaste('), 'paste handler is wired in the view')
  expect(__INDEX_SRC__.includes('copyEntry('), 'row copy uses the fallback copier')
  expect(__INDEX_SRC__.includes('editClip(') && __INDEX_SRC__.includes('applyClipMessage('), 'both directions go through the sync helpers')
  expect(__LOGIC_SRC__.includes("execCommand('copy')") && __LOGIC_SRC__.includes("createElement('textarea')"), 'write fallback is textarea plus execCommand')
  resetClipboard()
}
