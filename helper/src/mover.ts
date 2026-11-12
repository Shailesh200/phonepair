/** One mouse-mover timer. Intervals are only 30s, 1m, and 5m. */

export const MOVER_INTERVALS = ['30s', '1m', '5m'] as const
export type MoverInterval = (typeof MOVER_INTERVALS)[number]

export const MOVER_MS: Record<MoverInterval, number> = {
  '30s': 30_000,
  '1m': 60_000,
  '5m': 300_000,
}

export type MoverState = {
  on: boolean
  interval: MoverInterval | null
}

export type TimerHandle = ReturnType<typeof setInterval>

export function isMoverInterval(value: unknown): value is MoverInterval {
  return value === '30s' || value === '1m' || value === '5m'
}

/** Read position, step +1px/+2px, then the original point to return to. */
export function nudgeTargets(pos: { x: number; y: number }): { away: { x: number; y: number }; home: { x: number; y: number } } {
  const x = Math.round(pos.x)
  const y = Math.round(pos.y)
  return { away: { x: x + 1, y: y + 2 }, home: { x, y } }
}

export type Mover = {
  state(): MoverState
  /** Start or restart the single timer. Null when `interval` is not 30s, 1m, or 5m. */
  start(interval: unknown): MoverState | null
  stop(): MoverState
}

const OFF: MoverState = { on: false, interval: null }

export function createMover(opts: {
  nudge: () => Promise<void> | void
  setTimer?: (fn: () => void, ms: number) => TimerHandle
  clearTimer?: (id: TimerHandle) => void
}): Mover {
  const setTimer = opts.setTimer ?? ((fn, ms) => setInterval(fn, ms))
  const clearTimer = opts.clearTimer ?? ((id) => { clearInterval(id) })
  let timer: TimerHandle | null = null
  let state: MoverState = { on: false, interval: null }

  const clear = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }

  return {
    state() {
      return { on: state.on, interval: state.interval }
    },
    start(interval) {
      if (!isMoverInterval(interval)) return null
      clear()
      state = { on: true, interval }
      timer = setTimer(() => {
        void Promise.resolve(opts.nudge()).catch(() => undefined)
      }, MOVER_MS[interval])
      return { on: true, interval }
    },
    stop() {
      clear()
      state = { on: false, interval: null }
      return { ...OFF }
    },
  }
}
