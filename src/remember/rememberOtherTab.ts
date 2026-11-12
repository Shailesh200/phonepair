import type { HostStore } from './records.ts'

export function hostRememberListenOtherTab(listenGaveUp: boolean, store: HostStore | null): boolean {
  return listenGaveUp && !!store?.phones?.length
}
