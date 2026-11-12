/** Minimum spacing between drop-hook entry points on one runner (code vs listen are separate). */
export const HOST_FORCE_HOOK_MIN_MS = 750

export function mayHostForceHook(now: number, lastHookAt: number, runnerBusy: boolean): boolean {
  if (runnerBusy) return false
  return now - lastHookAt >= HOST_FORCE_HOOK_MIN_MS
}
