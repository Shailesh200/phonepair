import { ppDebug } from './ppDebug.ts'
import { ppDebugListenPeerGenServerOpen } from './ppDebugListenPeer.ts'

export type PpDebugListenSocket = {
  wsCreated: number
  serverOpen: number
  unavailableId: number
  recoveryDropAt: number | null
  firstServerOpenAfterDropMs: number | null
}

function sock(): PpDebugListenSocket {
  const d = ppDebug()
  if (!d.listenSocket) {
    d.listenSocket = {
      wsCreated: 0,
      serverOpen: 0,
      unavailableId: 0,
      recoveryDropAt: null,
      firstServerOpenAfterDropMs: null,
    }
  }
  return d.listenSocket
}

export function ppDebugIncListenWsCreated(): void {
  sock().wsCreated += 1
}

export function ppDebugIncListenServerOpen(): void {
  const s = sock()
  s.serverOpen += 1
  ppDebug().listenSocketOpens += 1
  ppDebugListenPeerGenServerOpen(Date.now())
}

export function ppDebugIncListenSocketUnavailableId(): void {
  const s = sock()
  s.unavailableId += 1
  ppDebug().listenUnavailableId += 1
}

export function ppDebugMarkListenRecoveryDrop(at: number): void {
  sock().recoveryDropAt = at
}

export function ppDebugRecordListenFirstServerOpenAfterDrop(now: number): void {
  const s = sock()
  if (s.recoveryDropAt == null || s.firstServerOpenAfterDropMs != null) return
  s.firstServerOpenAfterDropMs = Math.max(0, now - s.recoveryDropAt)
}
