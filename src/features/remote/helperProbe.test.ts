import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { helperProbeTimeout, settleHelperProbe, type HelperProbeSocket } from './helperProbe.ts'

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function fakeSocket() {
  let closed = 0
  const socket: HelperProbeSocket = {
    send() {},
    close() { closed += 1 },
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
  }
  return {
    socket,
    closed: () => closed,
    error() { socket.onerror?.() },
    close() { socket.onclose?.() },
  }
}

function clock() {
  let now = 0
  let nextId = 1
  const timers: { id: number; at: number; fn: () => void }[] = []
  return {
    setTimer(fn: () => void, ms: number) {
      const id = nextId++
      timers.push({ id, at: now + ms, fn })
      return id
    },
    clearTimer(id: number) {
      const index = timers.findIndex((timer) => timer.id === id)
      if (index >= 0) timers.splice(index, 1)
    },
    advance(ms: number) {
      now += ms
      let due = timers.filter((timer) => timer.at <= now).sort((a, b) => a.at - b.at || a.id - b.id)
      while (due.length) {
        const timer = due[0]
        const index = timers.findIndex((item) => item.id === timer.id)
        if (index >= 0) {
          timers.splice(index, 1)
          timer.fn()
        }
        due = timers.filter((item) => item.at <= now).sort((a, b) => a.at - b.at || a.id - b.id)
      }
    },
    pending() { return timers.length },
  }
}

describe('helper probe timeout', () => {
  it('waits 15s only for the first port of the first attempt', () => {
    assert.equal(helperProbeTimeout(0, 0), 15000)
    assert.equal(helperProbeTimeout(0, 1), 900)
    assert.equal(helperProbeTimeout(0, 2), 900)
    assert.equal(helperProbeTimeout(0, 3), 900)
    assert.equal(helperProbeTimeout(1, 0), 900)
    assert.equal(helperProbeTimeout(1, 1), 900)
    assert.equal(helperProbeTimeout(4, 0), 900)
  })

  it('schedules that timeout and resolves down only when it fires', async () => {
    const cases = [
      { attempt: 0, portIndex: 0, ms: 15000 },
      { attempt: 0, portIndex: 1, ms: 900 },
      { attempt: 1, portIndex: 0, ms: 900 },
    ]
    for (const item of cases) {
      const time = clock()
      const { socket } = fakeSocket()
      let scheduled = 0
      let result: string | undefined
      const pending = settleHelperProbe({
        code: '123456',
        mine: 1,
        currentJob: () => 1,
        timeoutMs: helperProbeTimeout(item.attempt, item.portIndex),
        socket,
        setTimer: (fn, ms) => { scheduled = ms; return time.setTimer(fn, ms) },
        clearTimer: time.clearTimer,
        onPaired: () => {},
      })
      pending.then((value) => { result = value })
      assert.equal(scheduled, item.ms)
      time.advance(item.ms - 1)
      await flush()
      assert.equal(result, undefined)
      time.advance(1)
      await flush()
      assert.equal(result, 'down')
    }
  })
})

describe('helper probe error and close', () => {
  it('resolves down immediately when the socket errors', async () => {
    const time = clock()
    const fake = fakeSocket()
    let result: string | undefined
    const pending = settleHelperProbe({
      code: '123456',
      mine: 1,
      currentJob: () => 1,
      timeoutMs: helperProbeTimeout(0, 0),
      socket: fake.socket,
      setTimer: time.setTimer,
      clearTimer: time.clearTimer,
      onPaired: () => {},
    })
    pending.then((value) => { result = value })
    fake.error()
    await flush()
    assert.equal(result, 'down')
    assert.equal(time.pending(), 0)
    time.advance(15000)
    await flush()
    assert.equal(result, 'down')
  })

  it('resolves down immediately when the socket closes', async () => {
    const time = clock()
    const fake = fakeSocket()
    let result: string | undefined
    const pending = settleHelperProbe({
      code: '123456',
      mine: 1,
      currentJob: () => 1,
      timeoutMs: 15000,
      socket: fake.socket,
      setTimer: time.setTimer,
      clearTimer: time.clearTimer,
      onPaired: () => {},
    })
    pending.then((value) => { result = value })
    fake.close()
    await flush()
    assert.equal(result, 'down')
    assert.equal(time.pending(), 0)
    time.advance(15000)
    assert.equal(result, 'down')
  })
})
