/** Screen-control messages shared by the phone and the laptop tab.
 *
 * Phone -> laptop (`ScMsg`):
 * - `{t:'sc:start'}` when the phone's Control toggle turns on.
 * - `{t:'sc', a:'move'|'down'|'up'|'click'|'dbl'|'right', x, y}` with x,y in 0..1
 *   on the video content box (letterbox removed).
 * - `{t:'sc', a:'scroll', dx, dy}` for a two-finger drag.
 *
 * Laptop -> phone:
 * - `{t:'sc:avail', on, reason?}` whenever control availability changes.
 *   `on` is true only when the helper is connected AND the shared track's
 *   `displaySurface` is `'monitor'`. Sent once when sharing starts, then
 *   again on every change.
 * - `{t:'sc:stop'}` when Stop or Esc on the laptop ends control.
 *   After Stop, Esc, or `sc:stop`, the laptop drops every `sc` message until
 *   `sc:start`, or until screen sharing starts again.
 *
 * Keys stay on the existing remote messages (`remote:key`, `remote:type`).
 */

export const SC_ACTIONS = ['move', 'down', 'up', 'click', 'dbl', 'right'] as const
export type ScAction = (typeof SC_ACTIONS)[number]

/** Normalized point on the video content box. */
export type ScPointMsg = {
  t: 'sc'
  a: ScAction
  x: number
  y: number
}

/** Two-finger scroll. dx and dy are pixel deltas, not normalized coordinates. */
export type ScScrollMsg = {
  t: 'sc'
  a: 'scroll'
  dx: number
  dy: number
}

export type ScMsg = ScPointMsg | ScScrollMsg

/** Phone -> laptop. Control was switched on. Clears the laptop's stop latch. */
export type ScStartMsg = {
  t: 'sc:start'
}

/** Stable `sc:avail` reason codes. */
export const SC_REASON_SURFACE = 'surface'
export const SC_REASON_HELPER = 'helper'
/** `getSettings().displaySurface` was missing or empty. */
export const SC_REASON_EMPTY = 'empty'

/** Phone copy when `reason` is `surface`. Send no `sc` events in that case. */
export const SC_SURFACE_HINT = 'Share your entire screen to control it'
/** Phone and laptop copy when the shared track reports no displaySurface. */
export const SC_EMPTY_HINT = 'Share your entire screen to enable control'

/** `surface`: not a full-screen monitor share. `empty`: displaySurface was blank. `helper`: Full laptop is off, so the phone stays view-only. */
export type ScAvailReason = typeof SC_REASON_SURFACE | typeof SC_REASON_HELPER | typeof SC_REASON_EMPTY

/** Laptop -> phone. `on` is true only for a connected helper and `displaySurface === 'monitor'`. */
export type ScAvailMsg = {
  t: 'sc:avail'
  on: boolean
  reason?: ScAvailReason | string
}

/** Laptop -> phone. Stop or Esc ended control. */
export type ScStopMsg = {
  t: 'sc:stop'
}
