import { ppDebug } from './ppDebug.ts'

export type PpDebugForceDropSide = 'listen' | 'code'

export type PpDebugForceDrops = {
  selfDisconnect: number
  dropExternal: number
  dropIgnoredSelf: number
}

function side(which: PpDebugForceDropSide): PpDebugForceDrops {
  const d = ppDebug()
  if (!d.forceDrops) {
    d.forceDrops = {
      listen: { selfDisconnect: 0, dropExternal: 0, dropIgnoredSelf: 0 },
      code: { selfDisconnect: 0, dropExternal: 0, dropIgnoredSelf: 0 },
    }
  }
  return d.forceDrops[which]
}

export function ppDebugIncForceSelfDisconnect(which: PpDebugForceDropSide): void {
  side(which).selfDisconnect += 1
}

export function ppDebugIncSignalDropExternal(which: PpDebugForceDropSide): void {
  side(which).dropExternal += 1
}

export function ppDebugIncSignalDropIgnoredSelf(which: PpDebugForceDropSide): void {
  side(which).dropIgnoredSelf += 1
}
