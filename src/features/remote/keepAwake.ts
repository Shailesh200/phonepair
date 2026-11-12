/** Keep-awake without the helper: mode, honest status, auto-stop, and relay.
 *
 * Real mouse nudges stay on the helper. This module never reports
 * "On (real mouse)" unless the helper is connected and has said it is on.
 */

import { isMoverInterval, readMoverState, type MoverInterval } from '../screen/mover.ts'

export const KEEP_AWAKE_MODES = ['helper', 'wakeLock', 'video', 'none'] as const
export type KeepAwakeMode = (typeof KEEP_AWAKE_MODES)[number]

export const KEEP_AWAKE_STATUSES = [
  'On (real mouse)',
  'On (screen awake)',
  'Paused, tab hidden',
  'Not supported',
] as const
export type KeepAwakeStatus = (typeof KEEP_AWAKE_STATUSES)[number]

export const AUTO_STOPS = ['15m', '30m', '1h', '2h', 'never'] as const
export type AutoStop = (typeof AUTO_STOPS)[number]

export const AUTO_STOP_MS: Record<Exclude<AutoStop, 'never'>, number> = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
}

export const AUTO_STOP_LABEL: Record<AutoStop, string> = {
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  never: 'Until stopped',
}

export const NUDGE_INTERVAL_HINT = 'Interval applies to laptop nudges.'

export const TIME_SCALE_MIN = 1
export const TIME_SCALE_MAX = 600

export type KeepAwakeViewState = {
  on: boolean
  interval: MoverInterval | null
  status: KeepAwakeStatus | null
  mode: KeepAwakeMode
  autoStop: AutoStop
}

export const KEEP_AWAKE_IDLE: KeepAwakeViewState = {
  on: false,
  interval: null,
  status: null,
  mode: 'none',
  autoStop: 'never',
}

export function isKeepAwakeMode(value: unknown): value is KeepAwakeMode {
  return value === 'helper' || value === 'wakeLock' || value === 'video' || value === 'none'
}

export function isKeepAwakeStatus(value: unknown): value is KeepAwakeStatus {
  return value === 'On (real mouse)' || value === 'On (screen awake)' || value === 'Paused, tab hidden' || value === 'Not supported'
}

export function isAutoStop(value: unknown): value is AutoStop {
  return value === '15m' || value === '30m' || value === '1h' || value === '2h' || value === 'never'
}

export type ModeInput = {
  helperConnected: boolean
  wakeLockHeld: boolean
  videoPlaying: boolean
  pipActive: boolean
  wakeLockApi: boolean
  videoApi: boolean
  /** A start finished, the tab is visible, and nothing is holding. */
  failed: boolean
}

/** Helper wins. Otherwise the hold we actually have, else the best API, else none. */
export function activeMode(input: ModeInput): KeepAwakeMode {
  if (input.helperConnected) return 'helper'
  if (input.wakeLockHeld) return 'wakeLock'
  if (input.videoPlaying || input.pipActive) return 'video'
  if (input.failed) return 'none'
  if (input.wakeLockApi) return 'wakeLock'
  if (input.videoApi) return 'video'
  return 'none'
}

export type HoldSignals = {
  requested: boolean
  helperConnected: boolean
  helperReportedOn: boolean
  wakeLockHeld: boolean
  videoPlaying: boolean
  pipActive: boolean
  tabHidden: boolean
  settled: boolean
}

/** One honest line. Null means off (or still waiting on the helper).
 * A hidden tab is paused unless Picture-in-Picture is actually up. A playing
 * fallback video does not keep the screen awake while the tab is hidden. */
export function deriveStatus(s: HoldSignals): KeepAwakeStatus | null {
  if (!s.requested) return null
  if (s.helperConnected && s.helperReportedOn) return 'On (real mouse)'
  if (s.tabHidden && !s.pipActive) return 'Paused, tab hidden'
  if (s.wakeLockHeld || s.videoPlaying || s.pipActive) return 'On (screen awake)'
  if (!s.settled) return null
  return 'Not supported'
}

/** Brief reconnects keep the timer. Closed and error stop it. Connected resyncs the phone. */
export function keepAwakeLinkEffect(status: string): 'stop' | 'resync' | 'keep' {
  if (status === 'closed' || status === 'error') return 'stop'
  if (status === 'connected') return 'resync'
  return 'keep'
}

/** How long a waiting, connecting, or reconnecting link may stay down before keep-awake stops. */
export const KEEPAWAKE_LINK_GRACE_MS = 30_000

const LINK_GRACE_STATUSES = new Set(['waiting', 'connecting', 'reconnecting'])

/** One grace timer for a dropped link. User disconnect and bye stop immediately. */
export function createKeepAwakeLinkWatch(opts: {
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (id: number) => void
  stop: () => void
  resync: () => void
  graceMs?: number
}) {
  let id: number | null = null
  const graceMs = opts.graceMs ?? KEEPAWAKE_LINK_GRACE_MS
  const clear = () => {
    if (id == null) return
    opts.clearTimer(id)
    id = null
  }
  return {
    /** Laptop Disconnect, unpair, or a peer bye. Cancels grace and stops now. */
    userStop() {
      clear()
      opts.stop()
    },
    onStatus(status: string) {
      const effect = keepAwakeLinkEffect(status)
      if (effect === 'stop') {
        clear()
        opts.stop()
        return
      }
      if (effect === 'resync') {
        clear()
        opts.resync()
        return
      }
      if (!LINK_GRACE_STATUSES.has(status) || id != null) return
      id = opts.setTimer(() => {
        id = null
        opts.stop()
      }, graceMs)
    },
    clear,
  }
}

export function dataState(status: KeepAwakeStatus | null): 'on' | 'off' | 'paused' | 'unsupported' {
  if (status === 'On (real mouse)' || status === 'On (screen awake)') return 'on'
  if (status === 'Paused, tab hidden') return 'paused'
  if (status === 'Not supported') return 'unsupported'
  return 'off'
}

/** Nudge interval is only meaningful while the helper is doing real moves. */
export function nudgeIntervalEnabled(mode: KeepAwakeMode, on: boolean): boolean {
  return mode === 'helper' && on
}

export function autoStopDelayMs(preset: AutoStop, scale: number): number | null {
  if (preset === 'never') return null
  const factor = scale >= TIME_SCALE_MIN ? scale : TIME_SCALE_MIN
  return Math.round(AUTO_STOP_MS[preset] / factor)
}

export function createAutoStopClock(opts: {
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (id: number) => void
  scale: number
  onFire: () => void
}) {
  let preset: AutoStop = 'never'
  let id: number | null = null
  let generation = 0
  const clear = () => {
    generation += 1
    if (id == null) return
    opts.clearTimer(id)
    id = null
  }
  return {
    preset() { return preset },
    /** Remember the preset and cancel a running timer. */
    select(next: AutoStop) {
      preset = next
      clear()
    },
    /** Arm from now. `never` arms nothing and returns null. One timer at a time. */
    arm(): number | null {
      clear()
      const ms = autoStopDelayMs(preset, opts.scale)
      if (ms == null) return null
      const gen = generation
      id = opts.setTimer(() => {
        if (gen !== generation) return
        id = null
        opts.onFire()
      }, ms)
      return ms
    },
    clear,
  }
}

function searchParams(search: string) {
  const q = search.startsWith('?') ? search.slice(1) : search
  return new URLSearchParams(q)
}

/** `?ppQa=1` turns on the keep-awake debug hooks. Off unless the flag is exactly 1. */
export function qaHooksEnabled(search: string): boolean {
  return searchParams(search).get('ppQa') === '1'
}

/** Attribute value for the control root. Omitted unless QA is on. */
export function qaModeAttribute(qa: boolean, mode: KeepAwakeMode): KeepAwakeMode | undefined {
  return qa ? mode : undefined
}

/** Visible debug text. Null hides the node. */
export function qaDebugText(qa: boolean, mode: KeepAwakeMode): string | null {
  return qa ? mode : null
}

/**
 * Read `ppTimeScale` once. 60 means one minute of preset time becomes one second.
 * Ignored in production unless `ppQa=1` is also set. Missing or junk values stay at 1.
 * Clamped to 1..600.
 */
export function readTimeScale(search: string, dev: boolean): number {
  const params = searchParams(search)
  if (!dev && params.get('ppQa') !== '1') return 1
  const raw = params.get('ppTimeScale')
  if (raw == null || raw.trim() === '') return 1
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1
  if (n < TIME_SCALE_MIN) return TIME_SCALE_MIN
  if (n > TIME_SCALE_MAX) return TIME_SCALE_MAX
  return n
}

export function browserSearch(): string {
  try {
    if (typeof location === 'undefined') return ''
    return location.search || ''
  } catch {
    return ''
  }
}

export function devBuild(): boolean {
  try {
    return Boolean(import.meta.env && import.meta.env.DEV)
  } catch {
    return false
  }
}

let cachedScale: number | undefined

/** The page reads the scale once. Later preset changes reuse that value. */
export function currentTimeScale(): number {
  if (cachedScale === undefined) cachedScale = readTimeScale(browserSearch(), devBuild())
  return cachedScale
}

export type RelayCommand =
  | { on: false; autoStop?: AutoStop }
  | { on: true; interval: MoverInterval; autoStop?: AutoStop }
  | { autoStop: AutoStop }

/** Phone command the laptop may run. Asks and unknown intervals are dropped. */
export function readRelayCommand(value: unknown): RelayCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const msg = value as Record<string, unknown>
  if (msg.ask === true) return null
  const autoStop = isAutoStop(msg.autoStop) ? msg.autoStop : undefined
  if (msg.on === false) return autoStop ? { on: false, autoStop } : { on: false }
  if (msg.on === true && isMoverInterval(msg.interval)) {
    return autoStop ? { on: true, interval: msg.interval, autoStop } : { on: true, interval: msg.interval }
  }
  if (msg.on == null && autoStop) return { autoStop }
  return null
}

export type RelayReport = {
  t: 'mover'
  on: boolean
  interval: MoverInterval | null
  status: KeepAwakeStatus | null
  mode: KeepAwakeMode
  autoStop: AutoStop
}

/** Laptop -> phone. `on` follows the honest status, not a click. */
export function relayReport(state: KeepAwakeViewState): RelayReport {
  const status = state.status
  const on = status != null
  return {
    t: 'mover',
    on,
    interval: on && state.interval ? state.interval : null,
    status: on ? status : null,
    mode: state.mode,
    autoStop: state.autoStop,
  }
}

/** Phone view of a laptop report. Real-mouse text is dropped unless mode is helper. */
export function readRelayReport(value: unknown): KeepAwakeViewState | null {
  const base = readMoverState(value)
  if (!base) return null
  const msg = value as Record<string, unknown>
  const mode = isKeepAwakeMode(msg.mode) ? msg.mode : 'none'
  const autoStop = isAutoStop(msg.autoStop) ? msg.autoStop : 'never'
  let status: KeepAwakeStatus | null = isKeepAwakeStatus(msg.status) ? msg.status : null
  if (!base.on) status = null
  if (status === 'On (real mouse)' && mode !== 'helper') status = null
  return {
    on: status != null,
    interval: base.interval,
    status,
    mode,
    autoStop,
  }
}

export function pictureInPictureEnabled(): boolean {
  try {
    return typeof document !== 'undefined' && document.pictureInPictureEnabled === true
  } catch {
    return false
  }
}
