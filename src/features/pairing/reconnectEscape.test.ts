import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mock, describe, it } from 'node:test'
import { RECONNECT_ESCAPE_MS, createReconnectEscape, endLaptopPair } from './reconnectEscape.ts'

describe('reconnect escape', () => {
  it('stays hidden until 60s of reconnecting, then resets when the link returns', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const seen: boolean[] = []
      const watch = createReconnectEscape({
        setTimer: (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimer: (id) => { clearTimeout(id as unknown as ReturnType<typeof setTimeout>) },
        onChange: (shown) => { seen.push(shown) },
      })
      watch.onStatus('reconnecting')
      mock.timers.tick(RECONNECT_ESCAPE_MS - 1000)
      assert.equal(watch.shown(), false)
      assert.deepEqual(seen, [])
      mock.timers.tick(1000)
      assert.equal(watch.shown(), true)
      assert.deepEqual(seen, [true])

      watch.onStatus('connected')
      assert.equal(watch.shown(), false)
      assert.deepEqual(seen, [true, false])

      watch.onStatus('reconnecting')
      mock.timers.tick(RECONNECT_ESCAPE_MS - 1000)
      assert.equal(watch.shown(), false)
      mock.timers.tick(1000)
      assert.equal(watch.shown(), true)
    } finally {
      mock.timers.reset()
    }
  })

  it('uses the laptop Disconnect path for Pair a different phone', () => {
    const order: string[] = []
    endLaptopPair(() => { order.push('stop') }, () => { order.push('disconnect') })
    assert.deepEqual(order, ['stop', 'disconnect'])
    const laptop = readFileSync(join(process.cwd(), 'src/Laptop.tsx'), 'utf8')
    assert.match(laptop, /onDisconnect=\{\(\) => endPair\(ctx\)\}/)
    assert.match(laptop, /id: 'disconnect', label: 'Disconnect'/)
    assert.match(laptop, /data-testid="reconnect-pair-different"/)
    assert.match(laptop, /Pair a different phone/)
    assert.match(laptop, /onClick=\{\(\) => endPair\(ctx\)\}>Pair a different phone/)
    assert.match(laptop, /function endPair\(ctx: CoreCtx\) \{\s*endLaptopPair\(stopMouseMover, \(\) => ctx\.link\.disconnect\(\)\)/)
  })
})
