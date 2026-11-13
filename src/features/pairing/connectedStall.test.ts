import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, mock } from 'node:test'
import {
  ICE_DISCONNECTED_GRACE_MS,
  ICE_POST_RESTORE_GRACE_MS,
  iceDisconnectedRedialDelayMs,
  enqueueOutbound,
  iceGraceMsAfterRestore,
  shouldQueueOutbound,
  shouldRedialAfterDisconnectedGrace,
} from './iceRecovery.ts'

describe('connected stall after restore', () => {
  it('delivers a queued clip within a few seconds of the conn opening, not after the 13s ICE grace', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
    const restoreAt = 1_000_000
    const connectedAt = restoreAt
    const grace = iceGraceMsAfterRestore({ now: connectedAt, restoreSignalAt: restoreAt })
    assert.equal(grace, ICE_POST_RESTORE_GRACE_MS)
    assert.ok(grace <= 3_000)
    const delay = Math.min(
      iceDisconnectedRedialDelayMs(connectedAt, connectedAt),
      iceDisconnectedRedialDelayMs(connectedAt, connectedAt, grace),
    )
    assert.equal(delay, 1_000)
    const deliveredAt = connectedAt + delay
    assert.ok(deliveredAt - connectedAt < 3_000)
    assert.ok(ICE_DISCONNECTED_GRACE_MS - grace >= 10_000)

    const clip = { t: 'clip:set', text: 'after restore', commit: true }
    const queued: typeof clip[] = []
    const sent: typeof clip[] = []
    if (shouldQueueOutbound({ live: true, connOpen: true, transportDead: true })) queued.push(clip)
    else sent.push(clip)
    assert.deepEqual(sent, [])
    assert.deepEqual(queued, [clip])
    if (!shouldQueueOutbound({ live: true, connOpen: true, transportDead: false })) {
      sent.push(...queued.splice(0))
    }
    assert.deepEqual(sent, [clip])
    assert.equal(iceGraceMsAfterRestore({ now: restoreAt + 60_000, restoreSignalAt: restoreAt }), ICE_DISCONNECTED_GRACE_MS)

    let delivered: string | null = null
    setTimeout(() => {
      if (shouldRedialAfterDisconnectedGrace(connectedAt, 'disconnected', connectedAt + delay, grace)) {
        if (!shouldQueueOutbound({ live: true, connOpen: true, transportDead: false })) delivered = clip.text
      }
    }, delay)
    mock.timers.tick(delay - 1)
    assert.equal(delivered, null)
    mock.timers.tick(1)
    assert.equal(delivered, clip.text)

    const link = readFileSync(join(process.cwd(), 'src/core/link.ts'), 'utf8')
    assert.match(link, /iceGraceMsAfterRestore\(\{/)
    assert.match(link, /shouldQueueOutbound\(\{/)
    assert.match(link, /flushOutbound\(\)/)
    assert.match(link, /shouldRedialAfterDisconnectedGrace\(since, state, Date\.now\(\), graceMs\)/)
    } finally {
      mock.timers.reset()
    }
  })

  it('does not replay mover, input, or keep-awake sent while the transport is down', () => {
    const down = { live: true, connOpen: true, transportDead: true }
    const up = { live: true, connOpen: true, transportDead: false }
    let queued: unknown[] = []
    for (const message of [
      { t: 'mover', on: false },
      { t: 'remote:click', btn: 'left' },
      { t: 'remote:key', key: 'Enter' },
    ]) {
      if (shouldQueueOutbound(down)) queued = enqueueOutbound(queued, message)
    }
    assert.deepEqual(queued, [])
    const replayed: unknown[] = []
    if (!shouldQueueOutbound(up)) replayed.push(...queued.splice(0))
    assert.deepEqual(replayed, [])
    const link = readFileSync(join(process.cwd(), 'src/core/link.ts'), 'utf8')
    assert.match(link, /enqueueOutbound\(this\.outbound, m\)/)
    assert.doesNotMatch(link, /outbound\.length > 20/)
  })

  it('delivers only the latest clip when two are queued while down', () => {
    const older = { t: 'clip:set', text: 'older', commit: true }
    const newer = { t: 'clip:set', text: 'newer', commit: true }
    let queued: unknown[] = []
    queued = enqueueOutbound(queued, older)
    queued = enqueueOutbound(queued, { t: 'mover', on: true, interval: '1m' })
    queued = enqueueOutbound(queued, newer)
    assert.deepEqual(queued, [newer])
    const delivered: unknown[] = []
    if (!shouldQueueOutbound({ live: true, connOpen: true, transportDead: false })) {
      delivered.push(...queued.splice(0))
    }
    assert.deepEqual(delivered, [newer])
  })
})
