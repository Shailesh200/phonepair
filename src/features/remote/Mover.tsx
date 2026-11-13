import React, { useEffect, useState } from 'react'
import {
  AUTO_STOPS,
  AUTO_STOP_LABEL,
  CUSTOM_MIN_MAX,
  dataState,
  keepAwakeClockText,
  keepAwakeSwitchOn,
  keepAwakeTimingText,
  parseCustomMin,
  qaDebugText,
  qaModeAttribute,
  type AutoStop,
  type KeepAwakeViewState,
} from './keepAwake'

export function MoverControl({ state, qa = false, showPip = false, onStart, onPause, onStop, onDuration, onCustomMinutes, onPip }: {
  state: KeepAwakeViewState
  qa?: boolean
  showPip?: boolean
  onStart: () => void
  onPause: () => void
  onStop: () => void
  onDuration: (preset: AutoStop) => void
  onCustomMinutes: (minutes: number) => void
  onPip?: () => void
}) {
  const view = dataState(state.status)
  const on = keepAwakeSwitchOn(state.status)
  const run = state.run ?? (on ? 'running' : 'off')
  const debug = qaDebugText(qa, state.mode)
  const [now, setNow] = useState(() => Date.now())
  const clock = keepAwakeClockText({ ...state, run }, now)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(state.customMin == null ? '' : String(state.customMin))
  const timing = keepAwakeTimingText(state, now)
  const showCustom = editing || state.autoStop === 'custom'

  useEffect(() => {
    if (editing) return
    setDraft(state.customMin == null ? '' : String(state.customMin))
  }, [state.customMin, editing])

  const commitDraft = () => {
    const minutes = parseCustomMin(draft)
    if (minutes == null) {
      setDraft(state.customMin == null ? '' : String(state.customMin))
      setEditing(false)
      return
    }
    onCustomMinutes(minutes)
    setEditing(false)
  }

  useEffect(() => {
    if (run !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [run])

  return <div className="pp-mover" data-state={view} data-timing={timing ? 'on' : 'off'} data-mode={qaModeAttribute(qa, state.mode)}>
    <div className="pp-mover-main">
      <span className="pp-mover-label">Keep awake</span>
      <span className="pp-mover-clock" data-testid="mover-clock">{clock}</span>
      <div className="pp-mover-actions">
        {run !== 'running' ? <button type="button" data-testid="mover-start" onClick={onStart}>Start</button> : null}
        {run === 'running' ? <button type="button" data-testid="mover-pause" onClick={onPause}>Pause</button> : null}
        {run !== 'off' ? <button type="button" data-testid="mover-stop" onClick={onStop}>Stop</button> : null}
      </div>
      <div className="pp-mover-interval" role="group" aria-label="How long keep-awake runs">
        {AUTO_STOPS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={state.autoStop === preset}
            data-testid={`mover-duration-${preset}`}
            onClick={() => {
              if (preset !== 'custom') {
                setEditing(false)
                onDuration(preset)
                return
              }
              setEditing(true)
              if (state.customMin != null) onCustomMinutes(state.customMin)
            }}
          >{AUTO_STOP_LABEL[preset]}</button>
        ))}
      </div>
    </div>
    {showCustom ? (
      <label className="pp-mover-custom">
        Minutes
        <input
          type="number"
          min={1}
          max={CUSTOM_MIN_MAX}
          inputMode="numeric"
          data-testid="mover-custom-min"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            commitDraft()
          }}
        />
      </label>
    ) : null}
    {showPip ? <button type="button" className="pp-mover-pip" data-testid="mover-pip" onClick={onPip}>Background wake</button> : null}
    {state.status ? <span className="pp-mover-badge" data-testid="mover-badge"><span data-testid="mover-status">{state.status}</span></span> : null}
    {timing ? <p className="pp-mover-hint" data-testid="mover-timing">{timing}</p> : null}
    {debug != null ? <p className="pp-mover-debug" data-testid="mover-debug-mode">{debug}</p> : null}
  </div>
}
