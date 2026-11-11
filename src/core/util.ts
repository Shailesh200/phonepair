export const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`
export const ago = (ts: number) => { const s = Math.round((Date.now() - ts) / 1000); return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago` }
export const uid = () => Math.random().toString(36).slice(2, 10)
export async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return true } catch {
    const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select()
    let ok = false; try { ok = document.execCommand('copy') } catch {}; ta.remove(); return ok
  }
}
export function linkify(text: string): (string | { href: string })[] {
  const out: (string | { href: string })[] = []
  const re = /\b((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]'"])/gi
  let last = 0; let m: RegExpExecArray | null
  while ((m = re.exec(text))) { if (m.index > last) out.push(text.slice(last, m.index)); out.push({ href: m[1].startsWith('www.') ? 'https://' + m[1] : m[1] }); last = m.index + m[1].length }
  if (last < text.length) out.push(text.slice(last))
  return out
}
export function download(url: string, name: string) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove() }
