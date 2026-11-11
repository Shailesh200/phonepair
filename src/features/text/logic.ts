// Pure helpers for text messages: length, history, and http(s) links only.

export const MAX_TEXT = 10_000
export const MAX_ITEMS = 50

export type TextDraft = { text: string; capped: boolean }
export type LinkPart = { type: 'text'; value: string } | { type: 'link'; href: string; value: string }

export function prepareText(raw: string): TextDraft | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.length <= MAX_TEXT) return { text: trimmed, capped: false }
  return { text: trimmed.slice(0, MAX_TEXT), capped: true }
}

export function addTextItem<T extends { id: string }>(items: readonly T[], item: T, max = MAX_ITEMS): T[] {
  if (!item.id || items.some((x) => x.id === item.id)) return items as T[]
  const next = [item, ...items]
  return next.length > max ? next.slice(0, max) : next
}

export function isSafeHttpUrl(href: string): boolean {
  if (typeof href !== 'string' || !href || /[\u0000-\u001F\u007F\s]/.test(href)) return false
  try {
    const u = new URL(href)
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname
  } catch {
    return false
  }
}

function badSchemePrefix(text: string, index: number): boolean {
  const from = Math.max(0, index - 32)
  return /(?:javascript|data|vbscript|file|blob)\s*:\s*$/i.test(text.slice(from, index))
}

function splitTrail(raw: string): [string, string] {
  let end = raw.length
  let changed = true
  while (changed && end > 0) {
    changed = false
    const ch = raw[end - 1]
    if (ch === '.' || ch === ',' || ch === ';' || ch === ':' || ch === '!' || ch === '?') {
      end--
      changed = true
      continue
    }
    if (ch === ')' || ch === ']') {
      const core = raw.slice(0, end)
      const open = ch === ')' ? '(' : '['
      let o = 0
      let c = 0
      for (const x of core) {
        if (x === open) o++
        else if (x === ch) c++
      }
      if (o < c) {
        end--
        changed = true
      }
    }
  }
  return [raw.slice(0, end), raw.slice(end)]
}

function toHref(core: string): string | null {
  if (!core) return null
  const href = /^www\./i.test(core) ? `https://${core}` : core
  return isSafeHttpUrl(href) ? href : null
}

export function linkParts(text: string): LinkPart[] {
  if (!text) return []
  const re = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
  const parts: LinkPart[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const index = m.index
    if (badSchemePrefix(text, index)) continue
    const [core] = splitTrail(m[0])
    const href = toHref(core)
    if (!href) continue
    if (index > last) parts.push({ type: 'text', value: text.slice(last, index) })
    parts.push({ type: 'link', href, value: core })
    last = index + core.length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts
}

export function firstSafeLink(text: string): string | null {
  for (const p of linkParts(text)) if (p.type === 'link') return p.href
  return null
}

export function openHrefFor(dir: 'in' | 'out', text: string): string | null {
  if (dir !== 'in') return null
  return firstSafeLink(text)
}

export function linkDomain(href: string): string {
  if (!isSafeHttpUrl(href)) return ''
  try { return new URL(href).hostname.replace(/^www\./i, '') } catch { return '' }
}

export function previewText(text: string, max = 80): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return one.slice(0, Math.max(0, max - 1)) + '…'
}
