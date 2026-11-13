/** Mouse-mover messages, next to the `sc` messages.
 *
 * Phone -> laptop, and laptop -> helper:
 * - `{t:'mover', on:true, interval:'3s'}` starts or restarts the nudge.
 *   Older helpers still report `30s`, `1m`, or `5m`; those reports still parse.
 * - `{t:'mover', on:false}` stops it.
 * - `{t:'mover', ask:true}` asks the laptop for the last helper report.
 *
 * Helper -> laptop page, and laptop -> phone:
 * - `{t:'mover', on, interval}` the helper's state. `interval` is null while off.
 *   The indicator follows this report. A click does not flip it early.
 */

export const MOVER_INTERVALS = ['3s', '30s', '1m', '5m'] as const
export type MoverInterval = (typeof MOVER_INTERVALS)[number]

export type MoverState = {
  on: boolean
  interval: MoverInterval | null
}

export const MOVER_HINT = 'Connect laptop control first.'
/** The page always asks for a nudge every 3 seconds. */
export const MOVER_DEFAULT_INTERVAL: MoverInterval = '3s'

export function isMoverInterval(value: unknown): value is MoverInterval {
  return value === '3s' || value === '30s' || value === '1m' || value === '5m'
}

export function moverBadgeText(interval: MoverInterval): string {
  return `Mouse mover on · every ${interval}`
}

export type MoverView = 'on' | 'off' | 'disconnected'

/** The row the page shows. Disconnected wins, even if a stale report says on. */
export function moverView(helperConnected: boolean, state: MoverState): MoverView {
  if (!helperConnected) return 'disconnected'
  return state.on && state.interval ? 'on' : 'off'
}

/** Helper report, or the laptop's relay of that report. Commands and asks are not reports. */
export function readMoverState(value: unknown): MoverState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const msg = value as Record<string, unknown>
  if (msg.t !== 'mover' || msg.ask === true) return null
  if (msg.on === false) return { on: false, interval: null }
  if (msg.on !== true || !isMoverInterval(msg.interval)) return null
  return { on: true, interval: msg.interval }
}

export type MoverCommand =
  | { on: false }
  | { on: true; interval: MoverInterval }

/** What a toggle click asks for. The switch stays put until a report arrives. */
export function moverToggleCommand(state: MoverState): MoverCommand {
  if (state.on) return { on: false }
  return { on: true, interval: MOVER_DEFAULT_INTERVAL }
}

/** Screen control ending does not stop keep-awake. Unpair, disconnect, socket close, the toggle, and helper quit do. */
export function moverStopsOn(reason: 'sc:stop' | 'endControl' | 'unpair' | 'disconnect' | 'socket-close' | 'toggle' | 'quit'): boolean {
  return reason !== 'sc:stop' && reason !== 'endControl'
}

/** Phone command the laptop may forward. Anything else is dropped. */
export function moverCommandFrom(value: unknown): MoverCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const msg = value as Record<string, unknown>
  if (msg.ask === true) return null
  if (msg.on === false) return { on: false }
  if (msg.on === true && isMoverInterval(msg.interval)) return { on: true, interval: msg.interval }
  return null
}
