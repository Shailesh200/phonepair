/** How long a host may stay on Reconnecting… before offering another phone. */
export const RECONNECT_ESCAPE_MS = 60_000

/** One timer while status stays reconnecting. Any other status clears it and hides the offer. */
export function createReconnectEscape(opts: {
  setTimer: (fn: () => void, ms: number) => number
  clearTimer: (id: number) => void
  onChange: (shown: boolean) => void
}) {
  let id: number | null = null
  let shown = false
  const clearTimer = () => {
    if (id == null) return
    opts.clearTimer(id)
    id = null
  }
  const hide = () => {
    clearTimer()
    if (!shown) return
    shown = false
    opts.onChange(false)
  }
  return {
    shown() { return shown },
    onStatus(status: string) {
      if (status === 'reconnecting') {
        if (id != null || shown) return
        id = opts.setTimer(() => {
          id = null
          shown = true
          opts.onChange(true)
        }, RECONNECT_ESCAPE_MS)
        return
      }
      hide()
    },
    /** Drop the timer without notifying. Used when the laptop view unmounts. */
    dispose() { clearTimer() },
  }
}

/** Same steps as the laptop Disconnect button: stop keep-awake, then end the pair. */
export function endLaptopPair(stopKeepAwake: () => void, disconnect: () => void) {
  stopKeepAwake()
  disconnect()
}
