import assert from 'node:assert/strict'
import { mock, describe, it } from 'node:test'
import {
  activeMode,
  autoStopDelayMs,
  createAutoStopClock,
  deriveStatus,
  qaDebugText,
  qaHooksEnabled,
  qaModeAttribute,
  readRelayCommand,
  readRelayReport,
  readTimeScale,
  relayReport,
  type HoldSignals,
  type ModeInput,
} from './keepAwake.ts'

const modeBase = (): ModeInput => ({
  helperConnected: false,
  wakeLockHeld: false,
  videoPlaying: false,
  pipActive: false,
  wakeLockApi: false,
  videoApi: false,
  failed: false,
})

const holdBase = (): HoldSignals => ({
  requested: true,
  helperConnected: false,
  helperReportedOn: false,
  wakeLockHeld: false,
  videoPlaying: false,
  pipActive: false,
  tabHidden: false,
  settled: true,
})

describe('keep-awake mode', () => {
  it('uses the helper when it is connected, else the hold, else the best API', () => {
    assert.equal(activeMode({ ...modeBase(), helperConnected: true, wakeLockHeld: true, videoPlaying: true, wakeLockApi: true, videoApi: true }), 'helper')
    assert.equal(activeMode({ ...modeBase(), wakeLockHeld: true, videoPlaying: true, wakeLockApi: true, videoApi: true }), 'wakeLock')
    assert.equal(activeMode({ ...modeBase(), videoPlaying: true, wakeLockApi: true, videoApi: true }), 'video')
    assert.equal(activeMode({ ...modeBase(), pipActive: true, videoApi: true }), 'video')
    assert.equal(activeMode({ ...modeBase(), wakeLockApi: true, videoApi: true }), 'wakeLock')
    assert.equal(activeMode({ ...modeBase(), videoApi: true }), 'video')
    assert.equal(activeMode({ ...modeBase(), failed: true, wakeLockApi: true, videoApi: true }), 'none')
    assert.equal(activeMode(modeBase()), 'none')
  })
})

describe('keep-awake status', () => {
  it('names exactly one honest state and never claims a real mouse without the helper', () => {
    assert.equal(deriveStatus({ ...holdBase(), requested: false, wakeLockHeld: true, helperReportedOn: true }), null)
    assert.equal(deriveStatus({ ...holdBase(), helperConnected: true, helperReportedOn: true, tabHidden: true }), 'On (real mouse)')
    assert.equal(deriveStatus({ ...holdBase(), helperConnected: false, helperReportedOn: true, wakeLockHeld: true }), 'On (screen awake)')
    assert.equal(deriveStatus({ ...holdBase(), helperConnected: false, helperReportedOn: true }), 'Not supported')
    assert.equal(deriveStatus({ ...holdBase(), wakeLockHeld: true }), 'On (screen awake)')
    assert.equal(deriveStatus({ ...holdBase(), videoPlaying: true, tabHidden: true }), 'On (screen awake)')
    assert.equal(deriveStatus({ ...holdBase(), pipActive: true, tabHidden: true }), 'On (screen awake)')
    assert.equal(deriveStatus({ ...holdBase(), tabHidden: true }), 'Paused, tab hidden')
    assert.equal(deriveStatus({ ...holdBase(), settled: false }), null)
    assert.equal(deriveStatus(holdBase()), 'Not supported')
  })
})

describe('keep-awake auto-stop', () => {
  it('maps presets and scales them', () => {
    assert.equal(autoStopDelayMs('never', 1), null)
    assert.equal(autoStopDelayMs('never', 60), null)
    assert.equal(autoStopDelayMs('15m', 1), 15 * 60 * 1000)
    assert.equal(autoStopDelayMs('30m', 1), 30 * 60 * 1000)
    assert.equal(autoStopDelayMs('1h', 1), 60 * 60 * 1000)
    assert.equal(autoStopDelayMs('2h', 1), 2 * 60 * 60 * 1000)
    assert.equal(autoStopDelayMs('15m', 60), 15 * 1000)
    assert.equal(autoStopDelayMs('1h', 60), 60 * 1000)
  })

  it('expires a preset on a fake timer and leaves Until stopped armed forever', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      let fired = 0
      const clock = createAutoStopClock({
        setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimer: (id) => { clearTimeout(id as unknown as ReturnType<typeof setTimeout>) },
        scale: 60,
        onFire: () => { fired += 1 },
      })
      clock.select('15m')
      assert.equal(clock.arm(), 15 * 1000)
      mock.timers.tick(15 * 1000 - 1)
      assert.equal(fired, 0)
      mock.timers.tick(1)
      assert.equal(fired, 1)

      fired = 0
      clock.select('never')
      assert.equal(clock.arm(), null)
      mock.timers.tick(60 * 60 * 1000)
      assert.equal(fired, 0)

      clock.select('30m')
      clock.arm()
      clock.select('never')
      mock.timers.tick(30 * 60 * 1000)
      assert.equal(fired, 0)
    } finally {
      mock.timers.reset()
    }
  })

  it('sends helper off when the scaled preset expires', () => {
    let scheduled: { fn: () => void; ms: number } | null = null
    const sent: { t: 'mover'; on: false }[] = []
    const clock = createAutoStopClock({
      setTimer(fn, ms) { scheduled = { fn, ms }; return 1 },
      clearTimer() { scheduled = null },
      scale: 60,
      onFire() { sent.push({ t: 'mover', on: false }) },
    })
    clock.select('2h')
    assert.equal(clock.arm(), 2 * 60 * 1000)
    assert.equal(sent.length, 0)
    const pending = scheduled
    assert.ok(pending)
    pending.fn()
    assert.deepEqual(sent, [{ t: 'mover', on: false }])
    clock.select('15m')
    clock.arm()
    assert.equal(scheduled?.ms, 15 * 1000)
    clock.clear()
    assert.equal(scheduled, null)
  })
})

describe('keep-awake time scale', () => {
  it('is off by default in production and clamps when QA or dev opts in', () => {
    assert.equal(readTimeScale('', false), 1)
    assert.equal(readTimeScale('?ppTimeScale=60', false), 1)
    assert.equal(readTimeScale('?ppTimeScale=60&ppQa=0', false), 1)
    assert.equal(readTimeScale('', true), 1)
    assert.equal(readTimeScale('?ppQa=1', false), 1)
    assert.equal(readTimeScale('?ppTimeScale=60', true), 60)
    assert.equal(readTimeScale('?ppTimeScale=60&ppQa=1', false), 60)
    assert.equal(readTimeScale('?ppQa=1&ppTimeScale=60', false), 60)
    assert.equal(readTimeScale('?ppTimeScale=0&ppQa=1', false), 1)
    assert.equal(readTimeScale('?ppTimeScale=-4&ppQa=1', false), 1)
    assert.equal(readTimeScale('?ppTimeScale=601&ppQa=1', false), 600)
    assert.equal(readTimeScale('?ppTimeScale=nope&ppQa=1', false), 1)
    assert.equal(readTimeScale('?ppTimeScale=&ppQa=1', false), 1)
  })
})

describe('keep-awake QA mode hook', () => {
  it('hides the mode unless ppQa=1, then exposes helper, wakeLock, video, or none', () => {
    assert.equal(qaHooksEnabled(''), false)
    assert.equal(qaHooksEnabled('?ppQa=0'), false)
    assert.equal(qaHooksEnabled('?ppTimeScale=60'), false)
    assert.equal(qaHooksEnabled('?ppQa=1'), true)
    assert.equal(qaModeAttribute(false, 'wakeLock'), undefined)
    assert.equal(qaDebugText(false, 'video'), null)
    for (const mode of ['helper', 'wakeLock', 'video', 'none'] as const) {
      assert.equal(qaModeAttribute(true, mode), mode)
      assert.equal(qaDebugText(true, mode), mode)
    }
  })
})

describe('keep-awake relay', () => {
  it('carries commands and honest reports, and drops a real-mouse claim without the helper', () => {
    assert.equal(readRelayCommand({ ask: true, on: true, interval: '30s' }), null)
    assert.equal(readRelayCommand({ on: true, interval: '10s' }), null)
    assert.deepEqual(readRelayCommand({ on: false }), { on: false })
    assert.deepEqual(readRelayCommand({ on: true, interval: '5m', autoStop: '1h' }), { on: true, interval: '5m', autoStop: '1h' })
    assert.deepEqual(readRelayCommand({ autoStop: '15m' }), { autoStop: '15m' })
    assert.deepEqual(readRelayCommand({ on: false, autoStop: '2h' }), { on: false, autoStop: '2h' })

    const awake = relayReport({
      on: true,
      interval: '30s',
      status: 'On (screen awake)',
      mode: 'wakeLock',
      autoStop: '30m',
    })
    assert.deepEqual(readRelayReport(awake), {
      on: true,
      interval: '30s',
      status: 'On (screen awake)',
      mode: 'wakeLock',
      autoStop: '30m',
    })

    const real = relayReport({
      on: true,
      interval: '1m',
      status: 'On (real mouse)',
      mode: 'helper',
      autoStop: 'never',
    })
    assert.equal(readRelayReport(real)?.status, 'On (real mouse)')
    assert.equal(readRelayReport(real)?.mode, 'helper')

    assert.equal(readRelayReport({
      t: 'mover', on: true, interval: '1m', status: 'On (real mouse)', mode: 'video', autoStop: 'never',
    })?.status, null)
    assert.equal(readRelayReport({
      t: 'mover', on: true, interval: '1m', status: 'On (real mouse)', mode: 'video',
    })?.on, false)

    assert.deepEqual(readRelayReport({
      t: 'mover', on: false, interval: '1m', status: 'On (screen awake)', mode: 'wakeLock', autoStop: '15m',
    }), {
      on: false,
      interval: null,
      status: null,
      mode: 'wakeLock',
      autoStop: '15m',
    })
    assert.equal(readRelayReport({ t: 'mover', ask: true }), null)
    assert.deepEqual(readRelayCommand({ t: 'mover', on: false }), { on: false })
  })
})
