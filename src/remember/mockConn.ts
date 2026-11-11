type Handler = (...args: unknown[]) => void

export type MockConn = {
  open: boolean
  peer: string
  sent: unknown[]
  closed: boolean
  send: (m: unknown) => void
  close: () => void
  on: (ev: string, fn: Handler) => void
  emit: (ev: string, ...args: unknown[]) => void
}

export function mockConn(peer: string): MockConn {
  const handlers: Record<string, Handler[]> = {}
  const sent: unknown[] = []
  return {
    open: true,
    peer,
    sent,
    closed: false,
    send(m) { sent.push(m) },
    close() { this.closed = true; this.open = false },
    on(ev, fn) { (handlers[ev] ||= []).push(fn) },
    emit(ev, ...args) { handlers[ev]?.forEach((f) => f(...args)) },
  }
}
