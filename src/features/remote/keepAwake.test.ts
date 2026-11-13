import assert from 'node:assert/strict'
import { mock, describe, it } from 'node:test'
import {
  activeMode,
  autoStopDelayMs,
  createAutoStopClock,
  dataState,
  deriveStatus,
  createKeepAwakeLinkWatch,
  keepAwakeSwitchOn,
  formatClockMs,
  keepAwakeClockText,
  keepAwakeTimingText,
  parseCustomMin,
  readKeepAwakeChoice,
  KEEPAWAKE_LINK_GRACE_MS,
  keepAwakeLinkEffect,
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
    assert.equal(deriveStatus({ ...holdBase(), videoPlaying: true, tabHidden: true, pipActive: false }), 'Paused, tab hidden')
    assert.equal(deriveStatus({ ...holdBase(), pipActive: true, tabHidden: true, videoPlaying: true }), 'On (screen awake)')
    assert.equal(deriveStatus({ ...holdBase(), tabHidden: true }), 'Paused, tab hidden')
    assert.equal(deriveStatus({ ...holdBase(), settled: false }), null)
    assert.equal(deriveStatus(holdBase()), 'Not supported')
  })

  it('pauses a hidden tab even if the fallback video is playing, unless PiP is up', () => {
    assert.equal(deriveStatus({ ...holdBase(), tabHidden: true, videoPlaying: true, pipActive: false, wakeLockHeld: true }), 'Paused, tab hidden')
    assert.equal(deriveStatus({ ...holdBase(), tabHidden: true, videoPlaying: true, pipActive: true }), 'On (screen awake)')
  })

  it('holds On (screen awake) while a wake lock is re-acquired', () => {
    const again = { ...holdBase(), wakeLockHeld: false, reacquiring: true, lastGood: 'On (screen awake)' as const }
    assert.equal(deriveStatus(again), 'On (screen awake)')
    assert.equal(deriveStatus({ ...again, wakeLockHeld: true }), 'On (screen awake)')
    assert.equal(deriveStatus({ ...again, reacquiring: false }), 'Not supported')
    assert.equal(deriveStatus({ ...again, lastGood: 'Paused, tab hidden' }), 'Not supported')
    assert.equal(deriveStatus({ ...again, lastGood: 'On (real mouse)' }), 'Not supported')
    assert.equal(deriveStatus({ ...again, lastGood: null, settled: false }), null)
    assert.equal(deriveStatus({ ...holdBase(), reacquiring: true }), 'Not supported')
  })

  it('says the helper is not running after it quits', () => {
    assert.equal(deriveStatus({ ...holdBase(), requested: false, helperStopped: true }), 'Helper not running')
    assert.equal(deriveStatus({ ...holdBase(), helperStopped: true, helperConnected: true, helperReportedOn: true }), 'Helper not running')
    assert.equal(deriveStatus({ ...holdBase(), requested: false }), null)
    assert.equal(dataState('Helper not running'), 'unsupported')
    assert.equal(keepAwakeSwitchOn('Helper not running'), false)
    assert.equal(keepAwakeSwitchOn('On (screen awake)'), true)
    assert.equal(keepAwakeSwitchOn(null), false)
    const quit = relayReport({
      on: false,
      interval: null,
      status: 'Helper not running',
      mode: 'none',
      autoStop: 'never',
      customMin: null,
      endsAt: null,
    })
    assert.equal(quit.on, false)
    assert.equal(quit.status, 'Helper not running')
    assert.deepEqual(readRelayReport(quit), {
      on: false,
      interval: null,
      status: 'Helper not running',
      mode: 'none',
      autoStop: 'never',
      customMin: null,
      endsAt: null,
    })
  })
})

describe('keep-awake link drops', () => {
  it('does not stop while reconnecting, and resends state once the link is back', () => {
    assert.equal(keepAwakeLinkEffect('reconnecting'), 'keep')
    assert.equal(keepAwakeLinkEffect('waiting'), 'keep')
    assert.equal(keepAwakeLinkEffect('connecting'), 'keep')
    assert.equal(keepAwakeLinkEffect('closed'), 'stop')
    assert.equal(keepAwakeLinkEffect('error'), 'stop')
    assert.equal(keepAwakeLinkEffect('connected'), 'resync')
  })

  it('stops at once on user disconnect, after 30s on peer leave, and survives a 14s drop', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      let stopped = 0
      let resent = 0
      let lock = true
      let video = true
      const watch = createKeepAwakeLinkWatch({
        setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimer: (id) => { clearTimeout(id as unknown as ReturnType<typeof setTimeout>) },
        graceMs: KEEPAWAKE_LINK_GRACE_MS,
        stop() {
          stopped += 1
          lock = false
          video = false
        },
        resync() { resent += 1 },
      })
      watch.userStop()
      assert.equal(stopped, 1)
      assert.equal(lock, false)
      assert.equal(video, false)
      mock.timers.tick(KEEPAWAKE_LINK_GRACE_MS)
      assert.equal(stopped, 1)

      stopped = 0
      lock = true
      video = true
      watch.onStatus('waiting')
      watch.onStatus('reconnecting')
      mock.timers.tick(KEEPAWAKE_LINK_GRACE_MS - 1)
      assert.equal(stopped, 0)
      assert.equal(lock, true)
      assert.equal(video, true)
      mock.timers.tick(1)
      assert.equal(stopped, 1)
      assert.equal(lock, false)
      assert.equal(video, false)

      stopped = 0
      resent = 0
      lock = true
      video = true
      watch.onStatus('reconnecting')
      mock.timers.tick(14_000)
      assert.equal(stopped, 0)
      watch.onStatus('connected')
      assert.equal(resent, 1)
      watch.onStatus('connected')
      assert.equal(resent, 1)
      assert.equal(lock, true)
      assert.equal(video, true)
      mock.timers.tick(KEEPAWAKE_LINK_GRACE_MS)
      assert.equal(stopped, 0)
      assert.equal(lock, true)
      assert.equal(video, true)
    } finally {
      mock.timers.reset()
    }
  })
})

describe('keep-awake auto-stop', () => {
  it('maps presets and scales them', () => {
    assert.equal(autoStopDelayMs('never', 1), null)
    assert.equal(autoStopDelayMs('never', 60), null)
    assert.equal(autoStopDelayMs('15m', 1), 15 * 60 * 1000)
    assert.equal(autoStopDelayMs('30m', 1), 30 * 60 * 1000)
    assert.equal(autoStopDelayMs('1h', 1), 60 * 60 * 1000)
    assert.equal(autoStopDelayMs('custom', 1, 120), 2 * 60 * 60 * 1000)
    assert.equal(autoStopDelayMs('custom', 1, null), null)
    assert.equal(autoStopDelayMs('custom', 1, 0), null)
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

  it('switching to a custom length drops the earlier preset and fires at that scaled time', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      let fired = 0
      const clock = createAutoStopClock({
        setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimer: (id) => { clearTimeout(id as unknown as ReturnType<typeof setTimeout>) },
        scale: 60,
        onFire: () => { fired += 1 },
      })
      clock.select('1h')
      assert.equal(clock.arm(), 60_000)
      mock.timers.tick(59_000)
      assert.equal(fired, 0)
      clock.select('custom', 120)
      assert.equal(clock.arm(), 120_000)
      mock.timers.tick(119_999)
      assert.equal(fired, 0)
      mock.timers.tick(1)
      assert.equal(fired, 1)
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
    clock.select('custom', 120)
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
    assert.deepEqual(readRelayCommand({ on: false, autoStop: '2h' }), { on: false })
    assert.deepEqual(readRelayCommand({ autoStop: 'custom', customMin: 45 }), { autoStop: 'custom', customMin: 45 })
    assert.deepEqual(readRelayCommand({ autoStop: 'custom', customMin: 0 }), { autoStop: 'custom' })

    const awake = relayReport({
      on: true,
      interval: '30s',
      status: 'On (screen awake)',
      mode: 'wakeLock',
      autoStop: '30m',
      customMin: null,
      endsAt: 1_700_000_000_000,
    })
    assert.deepEqual(readRelayReport(awake), {
      on: true,
      interval: '30s',
      status: 'On (screen awake)',
      mode: 'wakeLock',
      autoStop: '30m',
      customMin: null,
      endsAt: 1_700_000_000_000,
    })

    const real = relayReport({
      on: true,
      interval: '1m',
      status: 'On (real mouse)',
      mode: 'helper',
      autoStop: 'never',
      customMin: null,
      endsAt: null,
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
      customMin: null,
      endsAt: null,
    })
    assert.equal(readRelayReport({ t: 'mover', ask: true }), null)

    const ends = Date.UTC(2026, 10, 13, 12, 0, 0)
    assert.equal(keepAwakeTimingText({ status: null, autoStop: '30m', endsAt: ends }, ends - 14 * 60 * 1000), null)
    assert.equal(keepAwakeTimingText({ status: 'On (screen awake)', autoStop: 'never', endsAt: null }, ends), 'Until you stop it')
    const line = keepAwakeTimingText({ status: 'On (screen awake)', autoStop: '30m', endsAt: ends }, ends - 14 * 60 * 1000)
    assert.ok(line?.startsWith('Ends '))
    assert.match(line || '', /14m left/)
    assert.equal(formatClockMs(0), '00:00')
    assert.equal(formatClockMs(65_000), '01:05')
    assert.equal(keepAwakeClockText({ run: 'running', autoStop: 'never', endsAt: null, startedAt: 1_000 }, 61_000), '01:00')
    assert.equal(keepAwakeClockText({ run: 'paused', autoStop: '30m', endsAt: null, frozenRemain: 90_000 }, 0), '01:30')
    assert.equal(parseCustomMin(45), 45)
    assert.equal(parseCustomMin('90'), 90)
    assert.equal(parseCustomMin(1.5), null)
    assert.equal(parseCustomMin(24 * 60 + 1), null)
    assert.deepEqual(readKeepAwakeChoice(null), { autoStop: 'never', customMin: null })
    assert.deepEqual(readKeepAwakeChoice('{"autoStop":"30m","customMin":45}'), { autoStop: '30m', customMin: 45 })
    assert.deepEqual(readKeepAwakeChoice('{"autoStop":"2h"}'), { autoStop: 'never', customMin: null })
    assert.deepEqual(readKeepAwakeChoice('{'), { autoStop: 'never', customMin: null })
    assert.deepEqual(readRelayCommand({ t: 'mover', on: false }), { on: false })
  })
})
