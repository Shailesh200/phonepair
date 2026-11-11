const LAST_HOST = 'pp-last-host-name'
const LAST_CODE = 'pp-last-pair-code'

export function rememberLastLaptop(hostName: string, code: string) {
  try {
    sessionStorage.setItem(LAST_HOST, hostName)
    sessionStorage.setItem(LAST_CODE, code)
  } catch {}
}

export function lastLaptopSession(): { name: string; code: string } | null {
  try {
    const name = sessionStorage.getItem(LAST_HOST)
    const code = sessionStorage.getItem(LAST_CODE)
    if (name && code) return { name, code }
  } catch {}
  return null
}
