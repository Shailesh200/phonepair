import type Peer from 'peerjs'
import type { ForceSignalPeerStateExt } from './forceSignalPeerState.ts'
import { WS_CONNECTING } from './forceSignalPeerState.ts'
import { ppDebugIncListenSocketClosedConnecting } from './ppDebug.ts'
import { markPeerForceDisconnect } from './forceSignalSelf.ts'
import { ppDebugIncForceSelfDisconnect, type PpDebugForceDropSide } from './ppDebugForceDrops.ts'

const connectStarted = new WeakMap<Peer, number>()
const peerOpenAt = new WeakMap<Peer, number>()
const peerLastDropAt = new WeakMap<Peer, number>()

export function markPeerSignalDrop(peer: Peer, at: number): void {
  peerLastDropAt.set(peer, at)
}

function socketReadyState(peer: Peer): number | null {
  const s = (peer as { socket?: { _socket?: WebSocket } }).socket?._socket
  return s?.readyState ?? null
}

export function trackListenPeerSocketOpen(peer: Peer, onOpen?: () => void): void {
  peer.on('open', () => {
    connectStarted.delete(peer)
    peerOpenAt.set(peer, Date.now())
    onOpen?.()
  })
}

export function trackCodePeerSocketOpen(peer: Peer): void {
  peer.on('open', () => {
    peerOpenAt.set(peer, Date.now())
  })
}

export function peerAsForceSignal(
  peer: Peer,
  forceSide: PpDebugForceDropSide | null = null,
  onForce?: () => void,
): ForceSignalPeerStateExt {
  const bound: ForceSignalPeerStateExt = {
    get destroyed() {
      return peer.destroyed
    },
    get disconnected() {
      return peer.disconnected
    },
    get open() {
      return peer.open
    },
    disconnect: () => {
      const rs = socketReadyState(peer)
      if (rs === WS_CONNECTING) ppDebugIncListenSocketClosedConnecting()
      markPeerForceDisconnect(peer)
      if (forceSide) ppDebugIncForceSelfDisconnect(forceSide)
      peer.disconnect()
    },
    reconnect: () => {
      connectStarted.set(peer, Date.now())
      onForce?.()
      peer.reconnect()
    },
    signalReadyState: () => socketReadyState(peer),
    signalConnectStartedAt: () => {
      const rs = socketReadyState(peer)
      if (rs === WS_CONNECTING) {
        let t = connectStarted.get(peer)
        if (t == null) {
          t = Date.now()
          connectStarted.set(peer, t)
        }
        return t
      }
      return connectStarted.get(peer) ?? null
    },
    signalPeerOpenAt: () => peerOpenAt.get(peer) ?? null,
    signalLastDropAt: () => peerLastDropAt.get(peer) ?? null,
  }
  return bound
}
