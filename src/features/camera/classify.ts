// QR / barcode payload: a link we can open, or plain text we can copy.
export type CodeKind = 'url' | 'text'

export function classifyCode(value: string): CodeKind {
  const t = value.trim()
  if (/^https?:\/\//i.test(t)) return 'url'
  if (/^www\./i.test(t)) return 'url'
  return 'text'
}

/** Absolute http(s) URL for an "Open" action, or null when the payload is plain text. */
export function codeHref(value: string): string | null {
  if (classifyCode(value) !== 'url') return null
  const t = value.trim()
  return /^www\./i.test(t) ? `https://${t}` : t
}
