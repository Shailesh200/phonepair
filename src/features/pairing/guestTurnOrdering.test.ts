import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildRtcConfiguration, DEFAULT_ICE_SERVERS, mergeIceServers } from './peerConfig.ts'
import { effectiveRelayOnly, rtcConfigurationFromTurnPayload } from './rtcResolve.ts'
import { fetchTurnPayloadWithRetry } from './turnFetch.ts'
import { iceServersHaveTurn } from './iceServerMap.ts'
import { ppDebug } from './ppDebug.ts'

const STUN_ONLY = mergeIceServers(null)

describe('guest turn ordering', () => {
  it('awaits /api/turn before returning rtc config (no PC config before fetch settles)', async () => {
    let settled = false
    const fetchTurn = () =>
      new Promise<Response>((resolve) => {
        setTimeout(() => {
          settled = true
          resolve({
            ok: true,
            json: async () => ({ iceServers: [{ urls: 'turn:relay:3478' }] }),
          } as Response)
        }, 40)
      })
    const pending = fetchTurnPayloadWithRetry(fetchTurn as typeof fetch).then((payload) =>
      rtcConfigurationFromTurnPayload(payload, true),
    )
    assert.equal(settled, false)
    const cfg = await pending
    assert.equal(settled, true)
    assert.ok(cfg.iceServers?.length)
  })

  it('never applies relay-only with a STUN-only server list', () => {
    assert.equal(iceServersHaveTurn(STUN_ONLY), false)
    assert.equal(iceServersHaveTurn([{ urls: 'turn:x' }]), true)
    const { relayOnly, fellBack } = effectiveRelayOnly(STUN_ONLY, true)
    assert.equal(relayOnly, false)
    assert.equal(fellBack, true)
    const cfg = rtcConfigurationFromTurnPayload(null, true)
    assert.equal(cfg.iceTransportPolicy, 'all')
    assert.deepEqual(cfg.iceServers, DEFAULT_ICE_SERVERS)
    assert.equal(buildRtcConfiguration(STUN_ONLY, true).iceTransportPolicy, 'relay')
    assert.equal(rtcConfigurationFromTurnPayload(null, true).iceTransportPolicy, 'all')
    const before = ppDebug().relayFallbackNoTurn
    rtcConfigurationFromTurnPayload(null, true)
    assert.equal(ppDebug().relayFallbackNoTurn, before + 1)
  })
})
