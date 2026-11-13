/** Session record and web push. The join code is the session. Disconnect ends it. */

export function deviceKey(): string {
  const key = 'pp-device'
  try {
    const saved = localStorage.getItem(key)
    if (saved) return saved
    const id = Math.random().toString(36).slice(2, 10)
    localStorage.setItem(key, id)
    return id
  } catch {
    return 'device'
  }
}

async function post(body: Record<string, unknown>) {
  try {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch { /* the page can keep working with no session server */ }
}

export function joinPairSession(code: string, role: 'host' | 'guest', name: string) {
  if (!code) return
  return post({ op: 'join', code, id: deviceKey(), role, name })
}

export function endPairSession(code: string) {
  if (!code) return
  return post({ op: 'end', code })
}

export function notifyPair(code: string, title: string, body: string) {
  if (!code) return
  const url = typeof location === 'undefined' ? '/' : location.origin + '/'
  return post({ op: 'notify', code, title, body, from: deviceKey(), url })
}

function pushKey(key: string) {
  const pad = '='.repeat((4 - (key.length % 4)) % 4)
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Ask for notifications from a click. Joins the session either way. */
export async function enablePush(code: string, role: 'host' | 'guest', name: string) {
  await joinPairSession(code, role, name)
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('Notification' in window)) return false
  const reg = await navigator.serviceWorker.register('/sw.js')
  const res = await fetch('/api/session')
  const info = await res.json() as { push?: boolean; publicKey?: string }
  if (!info.push || !info.publicKey || !('PushManager' in window)) return false
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return false
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: pushKey(info.publicKey),
  })
  await post({ op: 'join', code, id: deviceKey(), role, name, push: sub.toJSON() })
  return true
}
