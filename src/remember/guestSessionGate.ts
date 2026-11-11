/** Phone home/tiles only after mutual-auth remember or a successful code pair. */
export function phoneShowsPairedHome(sessionPaired: boolean, status: string): boolean {
  return sessionPaired && status === 'connected'
}

export function phoneShowsConnecting(sessionPaired: boolean, status: string): boolean {
  if (status === 'error' || status === 'closed') return false
  return !phoneShowsPairedHome(sessionPaired, status)
}
