import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CODE_REJECTED,
  CODE_REQUIRED,
  HELPER_DOWN,
  HELPER_DROPPED,
  MAC_STEPS,
  WINDOWS_STEPS,
  applyConnectFocus,
  codeSubmitEnabled,
  connectStepBodies,
  connectStepStates,
  detectConnectPlatform,
  initialConnectGuide,
  reduceConnectGuide,
  stepsFor,
  type ConnectFocusTarget,
  type ConnectGuideEvent,
  type ConnectGuideState,
  type ConnectStep,
  type HelperSignals,
} from './connectGuide.ts'

function send(state: ConnectGuideState, event: ConnectGuideEvent): ConnectGuideState {
  return reduceConnectGuide(state, event)
}

function signals(status: HelperSignals['status'], attempt: HelperSignals['attempt'] = null): ConnectGuideEvent {
  return { type: 'signals', signals: { status, attempt } }
}

function stateOf(state: ConnectGuideState, id: ConnectStep) {
  const view = connectStepStates(state).find((step) => step.id === id)
  if (!view) throw new Error(`missing step ${id}`)
  return view.state
}

function confirmThrough(state: ConnectGuideState, step: ConnectStep): ConnectGuideState {
  let next = state.open ? state : send(state, { type: 'open-guide' })
  const target = stepsFor(next.platform).indexOf(step)
  if (target < 0) throw new Error(`${step} is not a ${next.platform} step`)
  while (next.step < target) next = send(next, { type: 'confirm' })
  return next
}

describe('connect guide reducer', () => {
  it('starts closed on the download step', () => {
    const state = initialConnectGuide()
    assert.equal(state.open, false)
    assert.equal(state.step, 0)
    assert.deepEqual(MAC_STEPS, ['download', 'open-mac', 'accessibility-mac', 'code'])
    assert.deepEqual(WINDOWS_STEPS, ['download', 'open-win', 'access-win', 'code'])
    const opened = send(state, { type: 'open-guide' })
    assert.equal(opened.open, true)
    assert.equal(stateOf(opened, 'download'), 'current')
    assert.equal(stateOf(opened, 'open-mac'), 'upcoming')
    assert.equal(stateOf(opened, 'accessibility-mac'), 'upcoming')
    assert.equal(stateOf(opened, 'code'), 'upcoming')
    assert.equal(connectStepStates(opened).every((step) => step.id === 'code' ? step.manual === false : step.manual === true), true)
  })

  it('does not mutate the previous state', () => {
    const state = initialConnectGuide()
    const snapshot = structuredClone(state)
    send(state, { type: 'open-guide' })
    assert.deepEqual(state, snapshot)
  })

  it('advances download, open, and accessibility only when the user confirms', () => {
    let state = send(initialConnectGuide(), { type: 'open-guide' })
    state = send(state, { type: 'confirm' })
    assert.equal(state.confirmed.download, true)
    assert.equal(state.confirmed['open-mac'], false)
    assert.equal(stateOf(state, 'download'), 'done')
    assert.equal(stateOf(state, 'open-mac'), 'current')
    state = send(state, { type: 'confirm' })
    assert.equal(state.confirmed['accessibility-mac'], false)
    assert.equal(stateOf(state, 'accessibility-mac'), 'current')
    state = send(state, { type: 'confirm' })
    assert.equal(state.confirmed['accessibility-mac'], true)
    assert.equal(stateOf(state, 'code'), 'current')
    const stuck = send(state, { type: 'confirm' })
    assert.equal(stuck.step, state.step)
    assert.equal(stuck.confirmed['accessibility-mac'], true)
  })

  it('ignores confirm, back, and typing while the guide is closed', () => {
    const state = initialConnectGuide()
    assert.equal(send(state, { type: 'confirm' }), state)
    assert.equal(send(state, { type: 'back' }), state)
    assert.equal(send(state, { type: 'code', value: '123456' }), state)
  })

  it('goes back one step, and back from the first step closes the guide', () => {
    let state = confirmThrough(initialConnectGuide(), 'accessibility-mac')
    state = send(state, { type: 'back' })
    assert.equal(stateOf(state, 'open-mac'), 'current')
    assert.equal(state.confirmed['accessibility-mac'], false)
    state = send(state, { type: 'back' })
    state = send(state, { type: 'back' })
    assert.equal(state.open, false)
    assert.equal(state.confirmed.download, true)
  })

  it('keeps a code error on the code step while the user reviews an earlier step', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, { type: 'submit' })
    assert.equal(state.error?.step, 'code')
    assert.equal(state.error?.message, CODE_REQUIRED)
    state = send(state, { type: 'back' })
    assert.equal(stateOf(state, 'accessibility-mac'), 'current')
    assert.equal(stateOf(state, 'code'), 'error')
    assert.equal(state.error?.message, CODE_REQUIRED)
  })

  it('strips the code to 6 digits and clears a code error when it changes', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, { type: 'code', value: '12ab34' })
    assert.equal(state.code, '1234')
    state = send(state, { type: 'submit' })
    assert.equal(state.error?.step, 'code')
    state = send(state, { type: 'code', value: '99-88-77' })
    assert.equal(state.code, '998877')
    assert.equal(state.error, null)
    state = send(state, signals('off', 'down'))
    assert.equal(state.error?.step, 'open-mac')
    state = send(state, { type: 'code', value: '111111' })
    assert.equal(state.error?.step, 'open-mac')
    assert.equal(state.code, '111111')
  })

  it('submits a 6-digit code without inventing an error', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, { type: 'code', value: '123456' })
    state = send(state, { type: 'submit' })
    assert.equal(state.error, null)
    assert.equal(stateOf(state, 'code'), 'current')
  })

  it('puts a rejected code on the code step and treats the helper as open', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, { type: 'code', value: '123456' })
    state = send(state, signals('connecting'))
    assert.equal(stateOf(state, 'code'), 'connecting')
    assert.equal(state.error, null)
    state = send(state, signals('off', 'rejected'))
    assert.equal(state.error?.step, 'code')
    assert.equal(state.error?.message, CODE_REJECTED)
    assert.equal(stateOf(state, 'code'), 'error')
    assert.equal(state.confirmed.download, true)
    assert.equal(state.confirmed['open-mac'], true)
    assert.equal(state.confirmed['accessibility-mac'], true)
    assert.equal(stateOf(state, 'open-mac'), 'done')
  })

  it('does not mark Accessibility done from a pair result', () => {
    let state = send(initialConnectGuide(), { type: 'open-guide' })
    state = send(state, signals('off', 'rejected'))
    assert.equal(state.confirmed.download, true)
    assert.equal(state.confirmed['open-mac'], true)
    assert.equal(state.confirmed['accessibility-mac'], false)
    assert.equal(stateOf(state, 'accessibility-mac'), 'upcoming')
    assert.equal(stateOf(state, 'code'), 'error')
    state = send(initialConnectGuide(), signals('connected'))
    assert.equal(state.confirmed['accessibility-mac'], false)
    assert.equal(stateOf(state, 'code'), 'connected')
    assert.equal(stateOf(state, 'accessibility-mac'), 'upcoming')
  })

  it('puts an unreachable helper on the open step', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, { type: 'code', value: '123456' })
    state = send(state, signals('connecting'))
    state = send(state, signals('off', 'down'))
    assert.equal(state.error?.step, 'open-mac')
    assert.equal(state.error?.message, HELPER_DOWN)
    assert.equal(stateOf(state, 'open-mac'), 'error')
    assert.equal(state.confirmed['open-mac'], false)
    assert.equal(state.confirmed.download, true)
    assert.equal(stateOf(state, 'download'), 'done')
    assert.equal(stateOf(state, 'code'), 'upcoming')
  })

  it('retry clears the error on that step and does not skip it', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('off', 'down'))
    state = send(state, { type: 'retry' })
    assert.equal(state.error, null)
    assert.equal(stateOf(state, 'open-mac'), 'current')
    assert.equal(state.confirmed['open-mac'], false)
    const again = send(state, signals('off', 'down'))
    assert.equal(again, state)
    state = send(state, { type: 'confirm' })
    assert.equal(state.confirmed['open-mac'], true)
    assert.equal(stateOf(state, 'accessibility-mac'), 'current')
  })

  it('shows a second unreachable result after the guide has moved on', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('off', 'down'))
    state = send(state, { type: 'retry' })
    state = send(state, { type: 'confirm' })
    state = send(state, { type: 'confirm' })
    state = send(state, signals('connecting'))
    state = send(state, signals('off', 'down'))
    assert.equal(state.error?.message, HELPER_DOWN)
    assert.equal(stateOf(state, 'open-mac'), 'error')
  })

  it('marks the code step connected when the helper pairs', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('connecting'))
    state = send(state, signals('connected', 'connected'))
    assert.equal(state.error, null)
    assert.equal(stateOf(state, 'code'), 'connected')
    assert.equal(state.confirmed.download, true)
    assert.equal(state.confirmed['open-mac'], true)
    assert.equal(stateOf(state, 'download'), 'done')
    assert.equal(stateOf(state, 'open-mac'), 'done')
    assert.equal(stateOf(state, 'accessibility-mac'), 'done')
  })

  it('lets the user go back while paired without being pulled forward again', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('connected'))
    state = send(state, { type: 'back' })
    assert.equal(stateOf(state, 'accessibility-mac'), 'current')
    assert.equal(stateOf(state, 'code'), 'connected')
    const same = send(state, signals('connected'))
    assert.equal(same.step, state.step)
    assert.equal(stateOf(same, 'accessibility-mac'), 'current')
  })

  it('opens an already paired helper on the connected step', () => {
    let state = send(initialConnectGuide(), signals('connected'))
    assert.equal(state.open, false)
    state = send(state, { type: 'open-guide' })
    assert.equal(state.open, true)
    assert.equal(stateOf(state, 'code'), 'connected')
    assert.equal(state.confirmed['accessibility-mac'], false)
  })

  it('reports a dropped socket on the code step', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('connected', 'connected'))
    state = send(state, signals('off', 'connected'))
    assert.equal(state.error?.step, 'code')
    assert.equal(state.error?.message, HELPER_DROPPED)
    assert.equal(stateOf(state, 'code'), 'error')
  })

  it('treats an intentional disconnect as not an error', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('connected', 'connected'))
    state = send(state, { type: 'user-disconnect' })
    assert.equal(state.open, false)
    assert.equal(state.error, null)
    assert.equal(state.signals.status, 'off')
    assert.equal(state.step, stepsFor(state.platform).indexOf('code'))
    const follow = send(state, signals('off', null))
    assert.equal(follow.error, null)
    assert.equal(follow.open, false)
    const reopened = send(follow, { type: 'open-guide' })
    assert.equal(stateOf(reopened, 'code'), 'current')
  })

  it('does not raise a drop error when the same off signal is applied twice', () => {
    let state = send(initialConnectGuide(), signals('connected'))
    state = send(state, { type: 'user-disconnect' })
    state = send(state, signals('off', null))
    state = send(state, signals('off', null))
    assert.equal(state.error, null)
  })

  it('blocks confirm on the step that is in error until retry', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('off', 'down'))
    const blocked = send(state, { type: 'confirm' })
    assert.equal(blocked.step, state.step)
    assert.equal(blocked.confirmed['open-mac'], false)
    assert.equal(blocked.error?.step, 'open-mac')
  })

  it('ignores submit while connecting or already paired', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, { type: 'code', value: '123456' })
    state = send(state, signals('connecting'))
    const connecting = send(state, { type: 'submit' })
    assert.equal(connecting, state)
    state = send(state, signals('connected'))
    const paired = send(state, { type: 'submit' })
    assert.equal(paired, state)
  })

  it('close leaves progress in place', () => {
    let state = confirmThrough(initialConnectGuide(), 'open-mac')
    state = send(state, { type: 'code', value: '42' })
    state = send(state, { type: 'close-guide' })
    assert.equal(state.open, false)
    assert.equal(state.confirmed.download, true)
    state = send(state, { type: 'open-guide' })
    assert.equal(stateOf(state, 'open-mac'), 'current')
    assert.equal(state.code, '42')
  })
})

function tracker() {
  const focused: string[] = []
  const node = (id: string): ConnectFocusTarget => ({ focus: () => focused.push(id) })
  return { focused, node }
}

describe('connect guide platform', () => {
  it('gives Windows an allow-access step and no Mac Accessibility step', () => {
    const opened = send(initialConnectGuide('windows'), { type: 'open-guide' })
    assert.deepEqual(connectStepStates(opened).map((step) => step.id), ['download', 'open-win', 'access-win', 'code'])
    let state = opened
    state = send(state, { type: 'confirm' })
    state = send(state, { type: 'confirm' })
    assert.equal(stateOf(state, 'access-win'), 'current')
    state = send(state, { type: 'confirm' })
    assert.equal(stateOf(state, 'code'), 'current')
  })

  it('switches the open and allow steps when the OS changes', () => {
    let state = confirmThrough(initialConnectGuide(), 'accessibility-mac')
    state = send(state, { type: 'platform', platform: 'windows' })
    assert.equal(state.platform, 'windows')
    assert.equal(stateOf(state, 'access-win'), 'current')
    assert.equal(connectStepStates(state).some((step) => step.id === 'accessibility-mac'), false)
    state = send(state, { type: 'platform', platform: 'mac' })
    assert.equal(stateOf(state, 'accessibility-mac'), 'current')
  })

  it('moves an unreachable-helper error onto the other OS open step', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('off', 'down'))
    assert.equal(state.error?.step, 'open-mac')
    state = send(state, { type: 'platform', platform: 'windows' })
    assert.equal(state.error?.step, 'open-win')
    assert.equal(stateOf(state, 'open-win'), 'error')
  })

  it('detects Windows from userAgentData ahead of platform', () => {
    assert.equal(detectConnectPlatform({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }), 'windows')
    assert.equal(detectConnectPlatform({ platform: 'Win32' }), 'windows')
    assert.equal(detectConnectPlatform({ platform: 'MacIntel' }), 'mac')
    assert.equal(detectConnectPlatform({}), 'mac')
  })

  it('renders exactly one body paragraph on every Mac and Windows step', () => {
    for (const id of MAC_STEPS) assert.equal(connectStepBodies(id).length, 1, id)
    for (const id of WINDOWS_STEPS) assert.equal(connectStepBodies(id).length, 1, id)
    assert.deepEqual(connectStepBodies('download'), ['generic'])
    assert.deepEqual(connectStepBodies('open-mac'), ['specific'])
    assert.deepEqual(connectStepBodies('accessibility-mac'), ['specific'])
    assert.deepEqual(connectStepBodies('open-win'), ['specific'])
    assert.deepEqual(connectStepBodies('access-win'), ['specific'])
    assert.deepEqual(connectStepBodies('code'), ['generic'])
  })

  it('enables the code arrow only when six digits are entered and the helper is not connecting', () => {
    assert.equal(codeSubmitEnabled('', 'off'), false)
    assert.equal(codeSubmitEnabled('12345', 'off'), false)
    assert.equal(codeSubmitEnabled('123456', 'off'), true)
    assert.equal(codeSubmitEnabled('123456', 'connecting'), false)
  })
})

describe('connect guide focus', () => {
  it('focuses the current step control when the guide opens', () => {
    const { focused, node } = tracker()
    const opened = send(initialConnectGuide(), { type: 'open-guide' })
    const nodes = new Map<string, ConnectFocusTarget>([
      ['download-mac', node('download-mac')],
      ['connect-confirm-download', node('connect-confirm-download')],
    ])
    const intent = applyConnectFocus({
      intent: 'step',
      open: opened.open,
      steps: connectStepStates(opened),
      query: (id) => nodes.get(id) ?? null,
      guide: node('connect-guide'),
      openButton: node('connect-open'),
    })
    assert.equal(intent, null)
    assert.deepEqual(focused, ['download-mac'])
  })

  it('focuses confirm, the code field, retry, or disconnect for the active step', () => {
    const { focused, node } = tracker()
    const nodes = new Map<string, ConnectFocusTarget>()
    const query = (id: string) => {
      const found = node(id)
      nodes.set(id, found)
      return found
    }
    const guide = node('connect-guide')
    const openButton = node('connect-open')

    let state = confirmThrough(initialConnectGuide(), 'open-mac')
    applyConnectFocus({ intent: 'step', open: true, steps: connectStepStates(state), query, guide, openButton })
    state = confirmThrough(state, 'accessibility-mac')
    applyConnectFocus({ intent: 'step', open: true, steps: connectStepStates(state), query, guide, openButton })
    state = confirmThrough(state, 'code')
    applyConnectFocus({ intent: 'step', open: true, steps: connectStepStates(state), query, guide, openButton })
    state = send(state, { type: 'submit' })
    applyConnectFocus({ intent: 'step', open: true, steps: connectStepStates(state), query, guide, openButton })
    state = send(state, signals('off', 'down'))
    applyConnectFocus({ intent: 'step', open: true, steps: connectStepStates(state), query, guide, openButton })
    state = send(confirmThrough(initialConnectGuide(), 'code'), signals('connected'))
    applyConnectFocus({ intent: 'step', open: true, steps: connectStepStates(state), query, guide, openButton })

    assert.deepEqual(focused, [
      'connect-confirm-open-mac',
      'connect-confirm-accessibility-mac',
      'helper-code',
      'connect-retry-code',
      'connect-retry-open-mac',
      'connect-disconnect',
    ])
  })

  it('focuses the guide section when the primary control is missing', () => {
    const { focused, node } = tracker()
    const opened = send(initialConnectGuide(), { type: 'open-guide' })
    applyConnectFocus({
      intent: 'step',
      open: true,
      steps: connectStepStates(opened),
      query: () => null,
      guide: node('connect-guide'),
      openButton: node('connect-open'),
    })
    assert.deepEqual(focused, ['connect-guide'])
  })

  it('returns focus to Connect only after that button is mounted again', () => {
    const { focused, node } = tracker()
    const steps = connectStepStates(initialConnectGuide())
    const held = applyConnectFocus({
      intent: 'open',
      open: true,
      steps,
      query: () => null,
      guide: node('connect-guide'),
      openButton: node('connect-open'),
    })
    assert.equal(held, 'open')
    assert.deepEqual(focused, [])
    const cleared = applyConnectFocus({
      intent: held,
      open: false,
      steps,
      query: () => null,
      guide: node('connect-guide'),
      openButton: node('connect-open'),
    })
    assert.equal(cleared, null)
    assert.deepEqual(focused, ['connect-open'])
  })
})
