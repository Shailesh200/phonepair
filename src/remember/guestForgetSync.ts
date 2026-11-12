import type { SavedLaptop } from './records.ts'

export function guestForgetShouldSync(
  connected: boolean,
  rememberListenId: string | undefined,
  sessionPaired: boolean,
  lap: SavedLaptop,
  savedLaptopCount: number,
): boolean {
  if (!connected) return false
  if (rememberListenId && rememberListenId === lap.listenId) return true
  if (sessionPaired && !rememberListenId && savedLaptopCount === 1) return true
  return false
}
