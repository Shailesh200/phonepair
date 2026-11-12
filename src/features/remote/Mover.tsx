import React from 'react'
import {
  MOVER_HINT,
  MOVER_INTERVALS,
  moverBadgeText,
  moverView,
  type MoverInterval,
  type MoverState,
} from '../screen/mover'

export function MoverControl({ connected, state, onToggle, onInterval }: {
  connected: boolean
  state: MoverState
  onToggle: () => void
  onInterval: (interval: MoverInterval) => void
}) {
  const view = moverView(connected, state)
  const on = view === 'on'
  return <div className="pp-mover" data-state={view}>
    <span className="pp-mover-label">Keep awake</span>
    <button
      type="button"
      className="pp-switch"
      role="switch"
      aria-checked={on}
      aria-label="Keep awake"
      data-testid="mover-toggle"
      disabled={!connected}
      onClick={onToggle}
    ><span /></button>
    <div className="pp-mover-interval" role="group" aria-label="Nudge interval">
      {MOVER_INTERVALS.map((interval) => (
        <button
          key={interval}
          type="button"
          aria-pressed={on && state.interval === interval}
          data-testid={`mover-interval-${interval}`}
          disabled={!on}
          onClick={() => onInterval(interval)}
        >{interval}</button>
      ))}
    </div>
    {on && state.interval ? <span className="pp-mover-badge" data-testid="mover-badge">{moverBadgeText(state.interval)}</span> : null}
    <p className="pp-mover-hint">{MOVER_HINT}</p>
  </div>
}
