/**
 * Connect guide for full laptop control.
 *
 * The laptop page talks to the helper over a loopback WebSocket
 * (`connectHelper` in this folder). These are the signals that call already returns:
 *
 * - `status: 'connecting' | 'connected' | 'off'` — the live socket.
 * - `attempt: 'connected'` — paired. The helper accepted the 6-digit code.
 * - `attempt: 'rejected'` — the helper answered and refused the code, so it is open.
 * - `attempt: 'down'` — nothing answered, so the helper is not reachable.
 * - `status` falling from `connected` to `off` — the paired socket closed.
 *
 * Signals this page does not receive, so those steps stay a manual "I've done this"
 * confirm until a later pair attempt proves otherwise:
 *
 * - Download finished. The page only links to the release.
 * - Helper reachable before a pair attempt. The socket pairs immediately;
 *   there is no unauthenticated status check, and a guessed code would count
 *   toward the helper's lockout.
 * - Accessibility granted. The helper checks that itself (osascript, or
 *   Electron `isTrustedAccessibilityClient`) and never sends it to this page.
 *   A paired socket does not mean the permission is on.
 */

export const CONNECT_STEPS = ['download', 'open', 'accessibility', 'code'] as const
export type ConnectStep = (typeof CONNECT_STEPS)[number]

export type ConnectStepState = 'upcoming' | 'current' | 'done' | 'error' | 'connecting' | 'connected'

export type HelperStatus = 'off' | 'connecting' | 'connected'
export type HelperAttempt = 'connected' | 'rejected' | 'down' | 'cancelled' | null

export type HelperSignals = {
  status: HelperStatus
  attempt: HelperAttempt
}

export type ConnectError = {
  step: ConnectStep
  message: string
}

export type ConnectGuideState = {
  open: boolean
  /** Index into `CONNECT_STEPS`. The step the guide is showing. */
  step: number
  confirmed: { download: boolean; open: boolean; accessibility: boolean }
  signals: HelperSignals
  error: ConnectError | null
  code: string
}

export type ConnectGuideEvent =
  | { type: 'open-guide' }
  | { type: 'close-guide' }
  | { type: 'back' }
  | { type: 'retry' }
  | { type: 'confirm' }
  | { type: 'code'; value: string }
  | { type: 'submit' }
  | { type: 'user-disconnect' }
  | { type: 'signals'; signals: HelperSignals }

export const CODE_REQUIRED = 'Enter the 6-digit code printed by the helper.'
export const CODE_REJECTED = 'That code was rejected. Check the helper window and try again.'
export const HELPER_DOWN = "Couldn't reach the helper. Make sure it's running, and click Allow if Chrome asks about local network access, then try again."
export const HELPER_DROPPED = 'The helper disconnected. Open it again and enter the code.'

function emptySignals(): HelperSignals {
  return { status: 'off', attempt: null }
}

export function initialConnectGuide(): ConnectGuideState {
  return {
    open: false,
    step: 0,
    confirmed: { download: false, open: false, accessibility: false },
    signals: emptySignals(),
    error: null,
    code: '',
  }
}

function clampStep(step: number): number {
  if (step < 0) return 0
  if (step > CONNECT_STEPS.length - 1) return CONNECT_STEPS.length - 1
  return step
}

function stepIndex(step: ConnectStep): number {
  return CONNECT_STEPS.indexOf(step)
}

function digits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

function applySignals(state: ConnectGuideState, signals: HelperSignals): ConnectGuideState {
  const prev = state.signals
  if (prev.status === signals.status && prev.attempt === signals.attempt) return state

  if (signals.status === 'connected') {
    const arrived = prev.status !== 'connected'
    return {
      ...state,
      signals,
      error: null,
      confirmed: { ...state.confirmed, download: true, open: true },
      step: arrived ? stepIndex('code') : state.step,
    }
  }

  if (signals.status === 'connecting') {
    return { ...state, signals, error: null, step: stepIndex('code') }
  }

  if (prev.status === 'connected' && signals.status === 'off') {
    return {
      ...state,
      signals,
      error: { step: 'code', message: HELPER_DROPPED },
      step: stepIndex('code'),
    }
  }

  if (signals.status === 'off' && signals.attempt === 'down') {
    return {
      ...state,
      signals,
      confirmed: { ...state.confirmed, open: false },
      error: { step: 'open', message: HELPER_DOWN },
      step: stepIndex('open'),
    }
  }

  if (signals.status === 'off' && signals.attempt === 'rejected') {
    return {
      ...state,
      signals,
      confirmed: { ...state.confirmed, download: true, open: true },
      error: { step: 'code', message: CODE_REJECTED },
      step: stepIndex('code'),
    }
  }

  return { ...state, signals }
}

export function reduceConnectGuide(state: ConnectGuideState, event: ConnectGuideEvent): ConnectGuideState {
  if (!state.open && event.type !== 'open-guide' && event.type !== 'signals' && event.type !== 'user-disconnect' && event.type !== 'close-guide') {
    return state
  }

  switch (event.type) {
    case 'open-guide':
      return {
        ...state,
        open: true,
        step: state.signals.status === 'connected' ? stepIndex('code') : state.step,
      }
    case 'close-guide':
      return { ...state, open: false }
    case 'back':
      if (state.step <= 0) return { ...state, open: false }
      return { ...state, step: state.step - 1 }
    case 'retry':
      if (!state.error) return state
      return { ...state, error: null, step: stepIndex(state.error.step) }
    case 'confirm': {
      if (state.signals.status === 'connecting') return state
      const id = CONNECT_STEPS[state.step]
      if (id !== 'download' && id !== 'open' && id !== 'accessibility') return state
      if (state.error?.step === id) return state
      return {
        ...state,
        confirmed: { ...state.confirmed, [id]: true },
        step: clampStep(state.step + 1),
      }
    }
    case 'code': {
      const code = digits(event.value)
      return {
        ...state,
        code,
        error: state.error?.step === 'code' ? null : state.error,
      }
    }
    case 'submit': {
      if (state.signals.status === 'connecting' || state.signals.status === 'connected') return state
      if (!/^\d{6}$/.test(state.code)) {
        return { ...state, step: stepIndex('code'), error: { step: 'code', message: CODE_REQUIRED } }
      }
      return {
        ...state,
        step: stepIndex('code'),
        error: state.error?.step === 'code' ? null : state.error,
      }
    }
    case 'user-disconnect':
      return {
        ...state,
        open: false,
        error: null,
        signals: emptySignals(),
        step: state.signals.status === 'connected' ? stepIndex('code') : state.step,
      }
    case 'signals':
      return applySignals(state, event.signals)
    default:
      return state
  }
}

export type ConnectStepView = {
  id: ConnectStep
  state: ConnectStepState
  /** Download, open, and Accessibility have no live signal until a pair attempt. */
  manual: boolean
  error: string | null
}

function confirmedDone(state: ConnectGuideState, id: ConnectStep): boolean {
  if (id === 'download') return state.confirmed.download
  if (id === 'open') return state.confirmed.open
  if (id === 'accessibility') return state.confirmed.accessibility
  return false
}

/** `data-state` for each step. Derived from the guide; it does not advance it. */
export function connectStepStates(state: ConnectGuideState): ConnectStepView[] {
  return CONNECT_STEPS.map((id, index) => {
    let stepState: ConnectStepState
    if (state.error?.step === id) stepState = 'error'
    else if (id === 'code' && state.signals.status === 'connected') stepState = 'connected'
    else if (id === 'code' && state.signals.status === 'connecting') stepState = 'connecting'
    else if (index === state.step) stepState = 'current'
    else if (index < state.step && confirmedDone(state, id)) stepState = 'done'
    else stepState = 'upcoming'
    return {
      id,
      state: stepState,
      manual: id !== 'code',
      error: state.error?.step === id ? state.error.message : null,
    }
  })
}
