import type Peer from 'peerjs'
import type { ForceSignalPeerStateExt } from './forceSignalPeerState.ts'
import { WS_CONNECTING } from './forceSignalPeerState.ts'
import { ppDebugIncListenSocketClosedConnecting } from './ppDebug.ts'

const connectStarted = new WeakMap<Peer, number>()

function socketReadyState(peer: Peer): number | null {
  const s = (peer as { socket?: { _socket?: WebSocket } }).socket?._socket
  return s?.readyState ?? null
}

export function trackListenPeerSocketOpen(peer: Peer, onOpen?: () => void): void {
  peer.on('open', () => {
    connectStarted.delete(peer)
    onOpen?.()
  })
}

export function peerAsForceSignal(peer: Peer): ForceSignalPeerStateExt {
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
      peer.disconnect()
    },
    reconnect: () => {
      connectStarted.set(peer, Date.now())
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
  }
  return bound
}
