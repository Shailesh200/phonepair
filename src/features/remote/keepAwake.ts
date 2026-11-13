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
  'Helper not running',
] as const
export type KeepAwakeStatus = (typeof KEEP_AWAKE_STATUSES)[number]

export const AUTO_STOPS = ['15m', '30m', '1h', 'custom', 'never'] as const
export type AutoStop = (typeof AUTO_STOPS)[number]

export const AUTO_STOP_MS: Record<'15m' | '30m' | '1h', number> = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
}

export const AUTO_STOP_LABEL: Record<AutoStop, string> = {
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  custom: 'Custom',
  never: 'Until stopped',
}

/** Custom run length, in whole minutes. */
export const CUSTOM_MIN_MAX = 24 * 60

export const KEEP_AWAKE_CHOICE_KEY = 'phonepair.keepAwake.duration'

export const TIME_SCALE_MIN = 1
export const TIME_SCALE_MAX = 600

export type KeepAwakeViewState = {
  on: boolean
  interval: MoverInterval | null
  status: KeepAwakeStatus | null
  mode: KeepAwakeMode
  autoStop: AutoStop
  customMin: number | null
  /** Epoch ms when a finite run ends. Null when off or until stopped. */
  endsAt: number | null
  run?: 'off' | 'running' | 'paused'
  startedAt?: number | null
  frozenRemain?: number | null
  elapsedMs?: number | null
}

export const KEEP_AWAKE_IDLE: KeepAwakeViewState = {
  on: false,
  interval: null,
  status: null,
  mode: 'none',
  autoStop: 'never',
  customMin: null,
  endsAt: null,
}

export function isKeepAwakeMode(value: unknown): value is KeepAwakeMode {
  return value === 'helper' || value === 'wakeLock' || value === 'video' || value === 'none'
}

export function isKeepAwakeStatus(value: unknown): value is KeepAwakeStatus {
  return value === 'On (real mouse)' || value === 'On (screen awake)' || value === 'Paused, tab hidden' || value === 'Not supported' || value === 'Helper not running'
}

/** The switch follows a real hold. Helper quit is an explanation, with the switch off. */
export function keepAwakeSwitchOn(status: KeepAwakeStatus | null): boolean {
  return status != null && status !== 'Helper not running'
}

export function isAutoStop(value: unknown): value is AutoStop {
  return value === '15m' || value === '30m' || value === '1h' || value === 'custom' || value === 'never'
}

export function parseCustomMin(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  if (!Number.isInteger(n) || n < 1 || n > CUSTOM_MIN_MAX) return null
  return n
}

export function readKeepAwakeChoice(raw: string | null): { autoStop: AutoStop; customMin: number | null } {
  const empty = { autoStop: 'never' as const, customMin: null }
  if (!raw) return empty
  try {
    const parsed = JSON.parse(raw) as { autoStop?: unknown; customMin?: unknown }
    if (!isAutoStop(parsed.autoStop)) return empty
    return { autoStop: parsed.autoStop, customMin: parseCustomMin(parsed.customMin) }
  } catch {
    return empty
  }
}

export function loadKeepAwakeChoice(): { autoStop: AutoStop; customMin: number | null } {
  try {
    const ls = globalThis.localStorage
    return readKeepAwakeChoice(ls ? ls.getItem(KEEP_AWAKE_CHOICE_KEY) : null)
  } catch {
    return { autoStop: 'never', customMin: null }
  }
}

export function saveKeepAwakeChoice(choice: { autoStop: AutoStop; customMin: number | null }) {
  try {
    globalThis.localStorage?.setItem(KEEP_AWAKE_CHOICE_KEY, JSON.stringify({
      autoStop: choice.autoStop,
      customMin: choice.customMin,
    }))
  } catch { /* private mode */ }
}

/** Countdown in the old nudge-hint slot. Null while keep-awake is off. */
export function keepAwakeTimingText(
  state: Pick<KeepAwakeViewState, 'status' | 'autoStop' | 'endsAt'>,
  now: number,
): string | null {
  if (!keepAwakeSwitchOn(state.status)) return null
  if (state.autoStop === 'never') return 'Until you stop it'
  if (state.endsAt == null || !Number.isFinite(state.endsAt)) return null
  const leftMs = state.endsAt - now
  if (leftMs <= 0) return 'Ending now'
  const totalMin = Math.ceil(leftMs / 60_000)
  const end = new Date(state.endsAt)
  let hour = end.getHours()
  const ap = hour >= 12 ? 'PM' : 'AM'
  hour = hour % 12 || 12
  const minute = String(end.getMinutes()).padStart(2, '0')
  const left = totalMin < 60 ? `${totalMin}m` : `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`
  return `Ends ${hour}:${minute} ${ap} · ${left} left`
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
  /** True while a released wake lock is being requested again. */
  reacquiring?: boolean
  /** Last status that meant the screen was actually awake. */
  lastGood?: KeepAwakeStatus | null
  /** The helper was keeping the laptop awake and then quit. */
  helperStopped?: boolean
}

/** One honest line. Null means off (or still waiting on the helper).
 * A hidden tab is paused unless Picture-in-Picture is actually up. A playing
 * fallback video does not keep the screen awake while the tab is hidden.
 * Re-acquiring a wake lock keeps the last "On (screen awake)" instead of
 * flashing "Not supported" for the gap before request() resolves. */
export function deriveStatus(s: HoldSignals): KeepAwakeStatus | null {
  if (s.helperStopped) return 'Helper not running'
  if (!s.requested) return null
  if (s.helperConnected && s.helperReportedOn) return 'On (real mouse)'
  if (s.tabHidden && !s.pipActive) return 'Paused, tab hidden'
  if (s.wakeLockHeld || s.videoPlaying || s.pipActive) return 'On (screen awake)'
  if (s.reacquiring && s.lastGood === 'On (screen awake)') return 'On (screen awake)'
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
  let prevStatus: string | null = null
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
      const from = prevStatus
      prevStatus = status
      const effect = keepAwakeLinkEffect(status)
      if (effect === 'stop') {
        clear()
        opts.stop()
        return
      }
      if (effect === 'resync') {
        clear()
        if (from !== 'connected') opts.resync()
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
  if (status === 'Not supported' || status === 'Helper not running') return 'unsupported'
  return 'off'
}

/** Nudge interval is only meaningful while the helper is doing real moves. */
export function nudgeIntervalEnabled(mode: KeepAwakeMode, on: boolean): boolean {
  return mode === 'helper' && on
}

export function autoStopDelayMs(preset: AutoStop, scale: number, customMin?: number | null): number | null {
  if (preset === 'never') return null
  const factor = scale >= TIME_SCALE_MIN ? scale : TIME_SCALE_MIN
  if (preset === 'custom') {
    const mins = parseCustomMin(customMin)
    if (mins == null) return null
    return Math.round(mins * 60 * 1000 / factor)
  }
  return Math.round(AUTO_STOP_MS[preset] / factor)
}

export function createAutoStopClock(opts: {
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (id: number) => void
  scale: number
  onFire: () => void
}) {
  let preset: AutoStop = 'never'
  let customMin: number | null = null
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
    select(next: AutoStop, minutes?: number | null) {
      preset = next
      if (minutes !== undefined) customMin = parseCustomMin(minutes)
      clear()
    },
    /** Arm from now. `never` and an empty custom length arm nothing. One timer at a time. */
    arm(): number | null {
      clear()
      const ms = autoStopDelayMs(preset, opts.scale, customMin)
      if (ms == null) return null
      const gen = generation
      id = opts.setTimer(() => {
        if (gen !== generation) return
        id = null
        opts.onFire()
      }, ms)
      return ms
    },
    /** Arm an exact leftover, used when a paused run resumes. */
    armHold(ms: number): number | null {
      clear()
      if (!Number.isFinite(ms) || ms <= 0) return null
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

export function formatClockMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Countdown while a length is running. Elapsed time while it runs until stopped. */
export function keepAwakeClockText(state: {
  run?: 'off' | 'running' | 'paused'
  autoStop: AutoStop
  endsAt: number | null
  startedAt?: number | null
  frozenRemain?: number | null
  elapsedMs?: number | null
}, now: number): string {
  if (state.run === 'paused') {
    if (state.autoStop === 'never') return formatClockMs(state.elapsedMs ?? 0)
    return formatClockMs(state.frozenRemain ?? 0)
  }
  if (state.run === 'running') {
    if (state.autoStop === 'never') return formatClockMs(state.startedAt == null ? 0 : now - state.startedAt)
    if (state.endsAt == null) return formatClockMs(0)
    return formatClockMs(state.endsAt - now)
  }
  return state.autoStop === 'never' ? '00:00' : formatClockMs(autoStopDelayMs(state.autoStop, 1, null) ?? 0)
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
  | { on: false; autoStop?: AutoStop; customMin?: number }
  | { on: true; interval: MoverInterval; autoStop?: AutoStop; customMin?: number }
  | { autoStop: AutoStop; customMin?: number }
  | { pause: true }
  | { resume: true }

function withCustom(cmd: RelayCommand, msg: Record<string, unknown>): RelayCommand {
  const customMin = parseCustomMin(msg.customMin)
  return customMin == null ? cmd : { ...cmd, customMin }
}

/** Phone command the laptop may run. Asks and unknown intervals are dropped. */
export function readRelayCommand(value: unknown): RelayCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const msg = value as Record<string, unknown>
  if (msg.ask === true) return null
  if (msg.pause === true) return { pause: true }
  if (msg.resume === true) return { resume: true }
  const autoStop = isAutoStop(msg.autoStop) ? msg.autoStop : undefined
  if (msg.on === false) {
    const cmd: RelayCommand = autoStop ? { on: false, autoStop } : { on: false }
    return withCustom(cmd, msg)
  }
  if (msg.on === true && isMoverInterval(msg.interval)) {
    const cmd: RelayCommand = autoStop
      ? { on: true, interval: msg.interval, autoStop }
      : { on: true, interval: msg.interval }
    return withCustom(cmd, msg)
  }
  if (msg.on == null && autoStop) return withCustom({ autoStop }, msg)
  return null
}

export type RelayReport = {
  t: 'mover'
  on: boolean
  interval: MoverInterval | null
  status: KeepAwakeStatus | null
  mode: KeepAwakeMode
  autoStop: AutoStop
  customMin: number | null
  endsAt: number | null
}

/** Laptop -> phone. `on` follows the honest status, not a click. */
export function relayReport(state: KeepAwakeViewState): RelayReport {
  const status = state.status
  const on = keepAwakeSwitchOn(status)
  return {
    t: 'mover',
    on,
    interval: on && state.interval ? state.interval : null,
    status,
    mode: state.mode,
    autoStop: state.autoStop,
    customMin: state.customMin,
    endsAt: on ? state.endsAt : null,
  }
}

/** Phone view of a laptop report. Real-mouse text is dropped unless mode is helper. */
export function readRelayReport(value: unknown): KeepAwakeViewState | null {
  const base = readMoverState(value)
  if (!base) return null
  const msg = value as Record<string, unknown>
  const mode = isKeepAwakeMode(msg.mode) ? msg.mode : 'none'
  const autoStop = isAutoStop(msg.autoStop) ? msg.autoStop : 'never'
  const customMin = parseCustomMin(msg.customMin)
  const endsAt = base.on && typeof msg.endsAt === 'number' && Number.isFinite(msg.endsAt) ? msg.endsAt : null
  let status: KeepAwakeStatus | null = isKeepAwakeStatus(msg.status) ? msg.status : null
  if (!base.on && status !== 'Helper not running') status = null
  if (status === 'On (real mouse)' && mode !== 'helper') status = null
  return {
    on: keepAwakeSwitchOn(status),
    interval: base.interval,
    status,
    mode,
    autoStop,
    customMin,
    endsAt,
  }
}

export function pictureInPictureEnabled(): boolean {
  try {
    return typeof document !== 'undefined' && document.pictureInPictureEnabled === true
  } catch {
    return false
  }
}
