import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CODE_REJECTED,
  CODE_REQUIRED,
  CONNECT_STEPS,
  HELPER_DOWN,
  HELPER_DROPPED,
  connectStepStates,
  initialConnectGuide,
  reduceConnectGuide,
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
  const target = CONNECT_STEPS.indexOf(step)
  while (next.step < target) next = send(next, { type: 'confirm' })
  return next
}

describe('connect guide reducer', () => {
  it('starts closed on the download step', () => {
    const state = initialConnectGuide()
    assert.equal(state.open, false)
    assert.equal(state.step, 0)
    assert.deepEqual(CONNECT_STEPS, ['download', 'open', 'accessibility', 'code'])
    const opened = send(state, { type: 'open-guide' })
    assert.equal(opened.open, true)
    assert.equal(stateOf(opened, 'download'), 'current')
    assert.equal(stateOf(opened, 'open'), 'upcoming')
    assert.equal(stateOf(opened, 'accessibility'), 'upcoming')
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
    assert.equal(state.confirmed.open, false)
    assert.equal(stateOf(state, 'download'), 'done')
    assert.equal(stateOf(state, 'open'), 'current')
    state = send(state, { type: 'confirm' })
    assert.equal(state.confirmed.accessibility, false)
    assert.equal(stateOf(state, 'accessibility'), 'current')
    state = send(state, { type: 'confirm' })
    assert.equal(state.confirmed.accessibility, true)
    assert.equal(stateOf(state, 'code'), 'current')
    const stuck = send(state, { type: 'confirm' })
    assert.equal(stuck.step, state.step)
    assert.equal(stuck.confirmed.accessibility, true)
  })

  it('ignores confirm, back, and typing while the guide is closed', () => {
    const state = initialConnectGuide()
    assert.equal(send(state, { type: 'confirm' }), state)
    assert.equal(send(state, { type: 'back' }), state)
    assert.equal(send(state, { type: 'code', value: '123456' }), state)
  })

  it('goes back one step, and back from the first step closes the guide', () => {
    let state = confirmThrough(initialConnectGuide(), 'accessibility')
    state = send(state, { type: 'back' })
    assert.equal(stateOf(state, 'open'), 'current')
    assert.equal(state.confirmed.accessibility, false)
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
    assert.equal(stateOf(state, 'accessibility'), 'current')
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
    assert.equal(state.error?.step, 'open')
    state = send(state, { type: 'code', value: '111111' })
    assert.equal(state.error?.step, 'open')
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
    assert.equal(state.confirmed.open, true)
    assert.equal(state.confirmed.accessibility, true)
    assert.equal(stateOf(state, 'open'), 'done')
  })

  it('does not mark Accessibility done from a pair result', () => {
    let state = send(initialConnectGuide(), { type: 'open-guide' })
    state = send(state, signals('off', 'rejected'))
    assert.equal(state.confirmed.download, true)
    assert.equal(state.confirmed.open, true)
    assert.equal(state.confirmed.accessibility, false)
    assert.equal(stateOf(state, 'accessibility'), 'upcoming')
    assert.equal(stateOf(state, 'code'), 'error')
    state = send(initialConnectGuide(), signals('connected'))
    assert.equal(state.confirmed.accessibility, false)
    assert.equal(stateOf(state, 'code'), 'connected')
    assert.equal(stateOf(state, 'accessibility'), 'upcoming')
  })

  it('puts an unreachable helper on the open step', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, { type: 'code', value: '123456' })
    state = send(state, signals('connecting'))
    state = send(state, signals('off', 'down'))
    assert.equal(state.error?.step, 'open')
    assert.equal(state.error?.message, HELPER_DOWN)
    assert.equal(stateOf(state, 'open'), 'error')
    assert.equal(state.confirmed.open, false)
    assert.equal(state.confirmed.download, true)
    assert.equal(stateOf(state, 'download'), 'done')
    assert.equal(stateOf(state, 'code'), 'upcoming')
  })

  it('retry clears the error on that step and does not skip it', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('off', 'down'))
    state = send(state, { type: 'retry' })
    assert.equal(state.error, null)
    assert.equal(stateOf(state, 'open'), 'current')
    assert.equal(state.confirmed.open, false)
    const again = send(state, signals('off', 'down'))
    assert.equal(again, state)
    state = send(state, { type: 'confirm' })
    assert.equal(state.confirmed.open, true)
    assert.equal(stateOf(state, 'accessibility'), 'current')
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
    assert.equal(stateOf(state, 'open'), 'error')
  })

  it('marks the code step connected when the helper pairs', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('connecting'))
    state = send(state, signals('connected', 'connected'))
    assert.equal(state.error, null)
    assert.equal(stateOf(state, 'code'), 'connected')
    assert.equal(state.confirmed.download, true)
    assert.equal(state.confirmed.open, true)
    assert.equal(stateOf(state, 'download'), 'done')
    assert.equal(stateOf(state, 'open'), 'done')
    assert.equal(stateOf(state, 'accessibility'), 'done')
  })

  it('lets the user go back while paired without being pulled forward again', () => {
    let state = confirmThrough(initialConnectGuide(), 'code')
    state = send(state, signals('connected'))
    state = send(state, { type: 'back' })
    assert.equal(stateOf(state, 'accessibility'), 'current')
    assert.equal(stateOf(state, 'code'), 'connected')
    const same = send(state, signals('connected'))
    assert.equal(same.step, state.step)
    assert.equal(stateOf(same, 'accessibility'), 'current')
  })

  it('opens an already paired helper on the connected step', () => {
    let state = send(initialConnectGuide(), signals('connected'))
    assert.equal(state.open, false)
    state = send(state, { type: 'open-guide' })
    assert.equal(state.open, true)
    assert.equal(stateOf(state, 'code'), 'connected')
    assert.equal(state.confirmed.accessibility, false)
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
    assert.equal(state.step, CONNECT_STEPS.indexOf('code'))
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
    assert.equal(blocked.confirmed.open, false)
    assert.equal(blocked.error?.step, 'open')
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
    let state = confirmThrough(initialConnectGuide(), 'open')
    state = send(state, { type: 'code', value: '42' })
    state = send(state, { type: 'close-guide' })
    assert.equal(state.open, false)
    assert.equal(state.confirmed.download, true)
    state = send(state, { type: 'open-guide' })
    assert.equal(stateOf(state, 'open'), 'current')
    assert.equal(state.code, '42')
  })
})
