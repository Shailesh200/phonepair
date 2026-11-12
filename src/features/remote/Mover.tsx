import React from 'react'
import { MOVER_INTERVALS, type MoverInterval } from '../screen/mover'
import {
  AUTO_STOPS,
  AUTO_STOP_LABEL,
  NUDGE_INTERVAL_HINT,
  dataState,
  keepAwakeSwitchOn,
  nudgeIntervalEnabled,
  qaDebugText,
  qaModeAttribute,
  type AutoStop,
  type KeepAwakeViewState,
} from './keepAwake'

export function MoverControl({ state, qa = false, showPip = false, onToggle, onInterval, onAutoStop, onPip }: {
  state: KeepAwakeViewState
  qa?: boolean
  showPip?: boolean
  onToggle: () => void
  onInterval: (interval: MoverInterval) => void
  onAutoStop: (preset: AutoStop) => void
  onPip?: () => void
}) {
  const view = dataState(state.status)
  const on = keepAwakeSwitchOn(state.status)
  const nudges = nudgeIntervalEnabled(state.mode, on)
  const debug = qaDebugText(qa, state.mode)
  return <div className="pp-mover" data-state={view} data-interval={state.mode === 'helper' ? 'on' : 'off'} data-mode={qaModeAttribute(qa, state.mode)}>
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
      <div className="pp-mover-interval" role="group" aria-label="Nudge interval">
        {MOVER_INTERVALS.map((interval) => (
          <button
            key={interval}
            type="button"
            aria-pressed={nudges && state.interval === interval}
            data-testid={`mover-interval-${interval}`}
            disabled={!nudges}
            onClick={() => onInterval(interval)}
          >{interval}</button>
        ))}
      </div>
      <div className="pp-mover-interval pp-mover-autostop" role="group" aria-label="Auto-stop">
        {AUTO_STOPS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-pressed={state.autoStop === preset}
            data-testid={`mover-autostop-${preset}`}
            onClick={() => onAutoStop(preset)}
          >{AUTO_STOP_LABEL[preset]}</button>
        ))}
      </div>
    </div>
    {showPip ? <button type="button" className="pp-mover-pip" data-testid="mover-pip" onClick={onPip}>Picture-in-Picture</button> : null}
    {state.status ? <span className="pp-mover-badge" data-testid="mover-badge"><span data-testid="mover-status">{state.status}</span></span> : null}
    {state.mode === 'helper' ? null : <p className="pp-mover-hint">{NUDGE_INTERVAL_HINT}</p>}
    {debug != null ? <p className="pp-mover-debug" data-testid="mover-debug-mode">{debug}</p> : null}
  </div>
}
