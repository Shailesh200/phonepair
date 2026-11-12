import type { ForceSignalRunner } from './forceSignalReconnect.ts'

export function notifyHostPhoneConnected(
  listenRunner: ForceSignalRunner | null,
  codeRunner: ForceSignalRunner | null,
): void {
  listenRunner?.onPhoneConnected()
  codeRunner?.onPhoneConnected()
}
