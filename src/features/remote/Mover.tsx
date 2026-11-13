import React, { useEffect, useState } from 'react'
import {
  AUTO_STOPS,
  AUTO_STOP_LABEL,
  CUSTOM_MIN_MAX,
  dataState,
  keepAwakeSwitchOn,
  keepAwakeTimingText,
  parseCustomMin,
  qaDebugText,
  qaModeAttribute,
  type AutoStop,
  type KeepAwakeViewState,
} from './keepAwake'

export function MoverControl({ state, qa = false, showPip = false, onToggle, onDuration, onCustomMinutes, onPip }: {
  state: KeepAwakeViewState
  qa?: boolean
  showPip?: boolean
  onToggle: () => void
  onDuration: (preset: AutoStop) => void
  onCustomMinutes: (minutes: number) => void
  onPip?: () => void
}) {
  const view = dataState(state.status)
  const on = keepAwakeSwitchOn(state.status)
  const debug = qaDebugText(qa, state.mode)
  const [now, setNow] = useState(() => Date.now())
  const [draft, setDraft] = useState(state.customMin == null ? '' : String(state.customMin))
  const timing = keepAwakeTimingText(state, now)

  useEffect(() => {
    setDraft(state.customMin == null ? '' : String(state.customMin))
  }, [state.customMin])

  useEffect(() => {
    if (!on || state.endsAt == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [on, state.endsAt])

  return <div className="pp-mover" data-state={view} data-timing={timing ? 'on' : 'off'} data-mode={qaModeAttribute(qa, state.mode)}>
    <div className="pp-mover-main">
      <span className="pp-mover-label">Keep awake</span>
      <button
        type="button"
        className="pp-switch"
        role="switch"
        aria-checked={on}
        aria-label="Keep awake"
        data-testid="mover-toggle"
        onClick={onToggle}
      ><span /></button>
      <div className="pp-mover-interval" role="group" aria-label="How long keep-awake runs">
        {AUTO_STOPS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={state.autoStop === preset}
            data-testid={`mover-duration-${preset}`}
            onClick={() => onDuration(preset)}
          >{AUTO_STOP_LABEL[preset]}</button>
        ))}
      </div>
    </div>
    {state.autoStop === 'custom' ? (
      <label className="pp-mover-custom">
        Minutes
        <input
          type="number"
          min={1}
          max={CUSTOM_MIN_MAX}
          inputMode="numeric"
          data-testid="mover-custom-min"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            const minutes = parseCustomMin(e.target.value)
            if (minutes != null) onCustomMinutes(minutes)
          }}
        />
      </label>
    ) : null}
    {showPip ? <button type="button" className="pp-mover-pip" data-testid="mover-pip" onClick={onPip}>Picture-in-Picture</button> : null}
    {state.status ? <span className="pp-mover-badge" data-testid="mover-badge"><span data-testid="mover-status">{state.status}</span></span> : null}
    {timing ? <p className="pp-mover-hint" data-testid="mover-timing">{timing}</p> : null}
    {debug != null ? <p className="pp-mover-debug" data-testid="mover-debug-mode">{debug}</p> : null}
  </div>
}
