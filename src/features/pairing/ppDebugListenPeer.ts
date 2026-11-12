import { ppDebug } from './ppDebug.ts'

export type PpDebugListenPeerGen = {
  serverOpenAt: number | null
  incomingConn: number
}

export type PpDebugListenPeer = {
  rotations: number
  reconnects: number
  destroyedBeforeCreate: number
  currentGen: PpDebugListenPeerGen
  gens: PpDebugListenPeerGen[]
}

function peerDbg(): PpDebugListenPeer {
  const d = ppDebug()
  if (!d.listenPeer) {
    d.listenPeer = {
      rotations: 0,
      reconnects: 0,
      destroyedBeforeCreate: 0,
      currentGen: { serverOpenAt: null, incomingConn: 0 },
      gens: [],
    }
  }
  return d.listenPeer
}

export function ppDebugListenPeerRotation(): void {
  const p = peerDbg()
  p.rotations += 1
  p.currentGen = { serverOpenAt: null, incomingConn: 0 }
}

export function ppDebugListenPeerReconnect(): void {
  peerDbg().reconnects += 1
}

export function ppDebugListenPeerDestroyedBeforeCreate(): void {
  peerDbg().destroyedBeforeCreate += 1
}

export function ppDebugListenPeerGenServerOpen(at: number): void {
  const p = peerDbg()
  if (p.currentGen.serverOpenAt == null) p.currentGen.serverOpenAt = at
}

export function ppDebugListenPeerGenIncomingConn(): void {
  peerDbg().currentGen.incomingConn += 1
}

export function ppDebugFinalizeListenPeerGen(): void {
  const p = peerDbg()
  p.gens.push({ ...p.currentGen })
}
