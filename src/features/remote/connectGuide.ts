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
 *   A paired socket does not mean the permission is on. Windows has no
 *   Accessibility step.
 */

export const MAC_STEPS = ['download', 'open-mac', 'accessibility-mac', 'code'] as const
export const WINDOWS_STEPS = ['download', 'open-win', 'access-win', 'code'] as const

export type ConnectPlatform = 'mac' | 'windows'
export type ConnectStep = (typeof MAC_STEPS)[number] | (typeof WINDOWS_STEPS)[number]

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

export type ConnectConfirmed = {
  download: boolean
  'open-mac': boolean
  'open-win': boolean
  'accessibility-mac': boolean
  'access-win': boolean
}

export type ConnectGuideState = {
  open: boolean
  platform: ConnectPlatform
  /** Index into the steps for `platform`. */
  step: number
  confirmed: ConnectConfirmed
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
  | { type: 'platform'; platform: ConnectPlatform }
  | { type: 'user-disconnect' }
  | { type: 'signals'; signals: HelperSignals }

export const CODE_REQUIRED = 'Enter the 6-digit code printed by the helper.'
export const CODE_REJECTED = 'That code was rejected. Check the helper window and try again.'
export const HELPER_DOWN = "Couldn't reach the helper. Make sure it's running, and click Allow if Chrome asks about local network access, then try again."
export const HELPER_DROPPED = 'The helper disconnected. Open it again and enter the code.'

export function stepsFor(platform: ConnectPlatform): readonly ConnectStep[] {
  return platform === 'windows' ? WINDOWS_STEPS : MAC_STEPS
}

/** One instructional paragraph per step. OS-specific copy replaces the generic line. */
export function connectStepBodies(id: ConnectStep): Array<'generic' | 'specific'> {
  if (id === 'download' || id === 'open-mac' || id === 'open-win' || id === 'accessibility-mac' || id === 'access-win') return ['specific']
  return ['generic']
}

export function openStepFor(platform: ConnectPlatform): 'open-mac' | 'open-win' {
  return platform === 'windows' ? 'open-win' : 'open-mac'
}

/** `userAgentData.platform` wins. Anything that is not Windows stays on the Mac path. */
export function detectConnectPlatform(source?: { userAgentData?: { platform?: string } | null; platform?: string } | null): ConnectPlatform {
  const hinted = source?.userAgentData?.platform
  const raw = typeof hinted === 'string' && hinted.trim() ? hinted : (source?.platform ?? '')
  return /win/i.test(raw) ? 'windows' : 'mac'
}

export function codeSubmitEnabled(code: string, status: HelperStatus): boolean {
  return /^\d{6}$/.test(code) && status !== 'connecting'
}

function emptySignals(): HelperSignals {
  return { status: 'off', attempt: null }
}

function emptyConfirmed(): ConnectConfirmed {
  return { download: false, 'open-mac': false, 'open-win': false, 'accessibility-mac': false, 'access-win': false }
}

export function initialConnectGuide(platform: ConnectPlatform = 'mac'): ConnectGuideState {
  return {
    open: false,
    platform,
    step: 0,
    confirmed: emptyConfirmed(),
    signals: emptySignals(),
    error: null,
    code: '',
  }
}

function clampStep(step: number, length: number): number {
  if (step < 0) return 0
  if (step > length - 1) return length - 1
  return step
}

function codeIndex(platform: ConnectPlatform): number {
  return stepsFor(platform).indexOf('code')
}

function digits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6)
}

function manualStep(id: ConnectStep | undefined): id is 'download' | 'open-mac' | 'open-win' | 'accessibility-mac' | 'access-win' {
  return id === 'download' || id === 'open-mac' || id === 'open-win' || id === 'accessibility-mac' || id === 'access-win'
}

function accessStepFor(platform: ConnectPlatform): 'accessibility-mac' | 'access-win' {
  return platform === 'windows' ? 'access-win' : 'accessibility-mac'
}

function placeOn(platform: ConnectPlatform, id: ConnectStep): number {
  const steps = stepsFor(platform)
  const mapped = id === 'open-mac' || id === 'open-win'
    ? openStepFor(platform)
    : id === 'accessibility-mac' || id === 'access-win'
      ? accessStepFor(platform)
      : id
  const index = steps.indexOf(mapped)
  return index >= 0 ? index : 0
}

function switchPlatform(state: ConnectGuideState, platform: ConnectPlatform): ConnectGuideState {
  if (platform === state.platform) return state
  const current = stepsFor(state.platform)[state.step]
  let error = state.error
  if (error?.step === 'open-mac' || error?.step === 'open-win') {
    error = { step: openStepFor(platform), message: error.message }
  } else if (error?.step === 'accessibility-mac' || error?.step === 'access-win') {
    error = { step: accessStepFor(platform), message: error.message }
  } else if (error && !stepsFor(platform).includes(error.step)) {
    error = null
  }
  const confirmed = { ...state.confirmed }
  if (state.signals.status === 'connected' || state.signals.attempt === 'rejected') {
    confirmed.download = true
    confirmed[openStepFor(platform)] = true
  }
  return {
    ...state,
    platform,
    confirmed,
    error,
    step: placeOn(platform, current ?? 'download'),
  }
}

function applySignals(state: ConnectGuideState, signals: HelperSignals): ConnectGuideState {
  const prev = state.signals
  if (prev.status === signals.status && prev.attempt === signals.attempt) return state
  const openId = openStepFor(state.platform)

  if (signals.status === 'connected') {
    const arrived = prev.status !== 'connected'
    return {
      ...state,
      signals,
      error: null,
      confirmed: { ...state.confirmed, download: true, [openId]: true },
      step: arrived ? codeIndex(state.platform) : state.step,
    }
  }

  if (signals.status === 'connecting') {
    return { ...state, signals, error: null, step: codeIndex(state.platform) }
  }

  if (prev.status === 'connected' && signals.status === 'off') {
    return {
      ...state,
      signals,
      error: { step: 'code', message: HELPER_DROPPED },
      step: codeIndex(state.platform),
    }
  }

  if (signals.status === 'off' && signals.attempt === 'down') {
    return {
      ...state,
      signals,
      confirmed: { ...state.confirmed, [openId]: false },
      error: { step: openId, message: HELPER_DOWN },
      step: stepsFor(state.platform).indexOf(openId),
    }
  }

  if (signals.status === 'off' && signals.attempt === 'rejected') {
    return {
      ...state,
      signals,
      confirmed: { ...state.confirmed, download: true, [openId]: true },
      error: { step: 'code', message: CODE_REJECTED },
      step: codeIndex(state.platform),
    }
  }

  return { ...state, signals }
}

export function reduceConnectGuide(state: ConnectGuideState, event: ConnectGuideEvent): ConnectGuideState {
  if (!state.open && event.type !== 'open-guide' && event.type !== 'signals' && event.type !== 'user-disconnect' && event.type !== 'close-guide' && event.type !== 'platform') {
    return state
  }
  const steps = stepsFor(state.platform)

  switch (event.type) {
    case 'open-guide':
      return {
        ...state,
        open: true,
        step: state.signals.status === 'connected' ? codeIndex(state.platform) : state.step,
      }
    case 'close-guide':
      return { ...state, open: false }
    case 'back':
      if (state.step <= 0) return { ...state, open: false }
      return { ...state, step: state.step - 1 }
    case 'retry':
      if (!state.error) return state
      return { ...state, error: null, step: placeOn(state.platform, state.error.step) }
    case 'confirm': {
      if (state.signals.status === 'connecting') return state
      const id = steps[state.step]
      if (!manualStep(id)) return state
      if (state.error?.step === id) return state
      return {
        ...state,
        confirmed: { ...state.confirmed, [id]: true },
        step: clampStep(state.step + 1, steps.length),
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
      if (!codeSubmitEnabled(state.code, state.signals.status)) {
        return { ...state, step: codeIndex(state.platform), error: { step: 'code', message: CODE_REQUIRED } }
      }
      return {
        ...state,
        step: codeIndex(state.platform),
        error: state.error?.step === 'code' ? null : state.error,
      }
    }
    case 'platform':
      return switchPlatform(state, event.platform)
    case 'user-disconnect':
      return {
        ...state,
        open: false,
        error: null,
        signals: emptySignals(),
        step: state.signals.status === 'connected' ? codeIndex(state.platform) : state.step,
      }
    case 'signals':
      return applySignals(state, event.signals)
    default:
      return state
  }
}

export type ConnectCardState = 'idle' | 'steps' | 'waiting' | 'connected' | 'error'

export function connectCardState(state: ConnectGuideState): ConnectCardState {
  if (state.signals.status === 'connected') return 'connected'
  if (state.error) return 'error'
  if (state.signals.status === 'connecting') return 'waiting'
  if (!state.open) return 'idle'
  return 'steps'
}

export function editConnectCode(code: string, index: number, raw: string): string {
  const incoming = raw.replace(/\D/g, '')
  if (!incoming) return (code.slice(0, index) + code.slice(index + 1)).slice(0, 6)
  return (code.slice(0, index) + incoming + code.slice(index + Math.max(incoming.length, 1))).replace(/\D/g, '').slice(0, 6)
}

export type ConnectStepView = {
  id: ConnectStep
  state: ConnectStepState
  /** Steps other than the code advance only by an "I've done this" confirm. */
  manual: boolean
  error: string | null
}

function confirmedDone(state: ConnectGuideState, id: ConnectStep): boolean {
  if (id === 'download') return state.confirmed.download
  if (id === 'open-mac') return state.confirmed['open-mac']
  if (id === 'open-win') return state.confirmed['open-win']
  if (id === 'accessibility-mac') return state.confirmed['accessibility-mac']
  if (id === 'access-win') return state.confirmed['access-win']
  return false
}

/** `data-state` for each step on the active platform. Derived from the guide; it does not advance it. */
export function connectStepStates(state: ConnectGuideState): ConnectStepView[] {
  return stepsFor(state.platform).map((id, index) => {
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

export type ConnectFocusTarget = { focus: () => void }

/** Which control should take focus for the guide's active step. `connect-guide` is the section fallback. */
export function connectFocusId(steps: ConnectStepView[], platform: ConnectPlatform = 'mac'): string {
  const active = steps.find((step) => step.state === 'current' || step.state === 'connecting' || step.state === 'connected')
    ?? steps.find((step) => step.state === 'error')
  if (!active) return 'connect-guide'
  if (active.state === 'error') return `connect-retry-${active.id}`
  if (active.state === 'connected') return 'connect-disconnect'
  if (active.state === 'connecting') return 'connect-guide'
  if (active.id === 'code') return 'helper-code'
  if (active.id === 'download') return platform === 'windows' ? 'download-win' : 'download-mac'
  if (active.manual) return `connect-confirm-${active.id}`
  return 'connect-guide'
}

/** Focus the active step's control. If that control is missing, focus the guide section. */
export function focusConnectStep(
  steps: ConnectStepView[],
  query: (testid: string) => ConnectFocusTarget | null,
  guide: ConnectFocusTarget | null,
  platform: ConnectPlatform = 'mac',
): string {
  const id = connectFocusId(steps, platform)
  if (id !== 'connect-guide') {
    const node = query(id)
    if (node) {
      node.focus()
      return id
    }
  }
  guide?.focus()
  return 'connect-guide'
}

/**
 * Apply one focus intent. Opening focuses the active step. Closing focuses the
 * Connect button only once it is mounted again. Any other intent is left in place.
 */
export function applyConnectFocus(args: {
  intent: 'step' | 'open' | null
  open: boolean
  steps: ConnectStepView[]
  query: (testid: string) => ConnectFocusTarget | null
  guide: ConnectFocusTarget | null
  openButton: ConnectFocusTarget | null
  platform?: ConnectPlatform
}): 'step' | 'open' | null {
  if (args.intent === 'step' && args.open) {
    focusConnectStep(args.steps, args.query, args.guide, args.platform ?? 'mac')
    return null
  }
  if (args.intent === 'open' && !args.open) {
    args.openButton?.focus()
    return null
  }
  return args.intent
}
