import { ppDebug } from './ppDebug.ts'
import { ppDebugListenPeerGenIncomingConn } from './ppDebugListenPeer.ts'

export type PpDebugListenHost = {
  incomingConn: number
  connsOpened: number
  authStarted: number
  authCompleted: number
  socketReadyStateAgeMs: number | null
}

export function ppDebugListenHost(): PpDebugListenHost {
  const d = ppDebug()
  if (!d.listenHost) {
    d.listenHost = {
      incomingConn: 0,
      connsOpened: 0,
      authStarted: 0,
      authCompleted: 0,
      socketReadyStateAgeMs: null,
    }
  }
  return d.listenHost
}

export function ppDebugIncListenIncomingConn(): void {
  ppDebugListenHost().incomingConn += 1
  ppDebugListenPeerGenIncomingConn()
}

export function ppDebugIncListenConnOpened(): void {
  ppDebugListenHost().connsOpened += 1
}

export function ppDebugIncListenAuthStarted(): void {
  ppDebugListenHost().authStarted += 1
}

export function ppDebugIncListenAuthCompleted(): void {
  ppDebugListenHost().authCompleted += 1
}

export function ppDebugSetListenSocketReadyStateAgeMs(ageMs: number | null): void {
  ppDebugListenHost().socketReadyStateAgeMs = ageMs
}
