import type { Msg } from '../../core/bus'

export type RemoteClick = 'left' | 'right'
export type RemoteDir = 'prev' | 'next'

export type RemotePayload =
  | { t: 'remote:move'; dx: number; dy: number }
  | { t: 'remote:click'; btn: RemoteClick }
  | { t: 'remote:scroll'; dx: number; dy: number }
  | { t: 'remote:nav'; dir: RemoteDir }
  | { t: 'remote:type'; text: string }
  | { t: 'remote:key'; key: string }
  | { t: 'remote:pointer'; on: boolean }
  | { t: 'remote:helper'; ask?: boolean; on?: boolean }

export type RemoteSend = {
  /** Single outbound function. Every mode calls this and nothing else. */
  send: (msg: RemotePayload) => void
  move: (dx: number, dy: number) => void
  click: (btn: RemoteClick) => void
  scroll: (dx: number, dy: number) => void
  nav: (dir: RemoteDir) => void
  type: (text: string) => void
  key: (key: string) => void
  pointer: (on: boolean) => void
  helper: (body: { ask?: boolean; on?: boolean }) => void
}

let channelsCreated = 0

/** How many shared send paths have been built. One Remote mount builds one. */
export function remoteChannelsCreated() {
  return channelsCreated
}

/** One connection's send path, shared by trackpad, clicker, and pointer. */
export function createRemoteSend(send: (msg: Msg) => void): RemoteSend {
  channelsCreated += 1
  const emit = (msg: RemotePayload) => { send(msg) }
  return {
    send: emit,
    move: (dx, dy) => emit({ t: 'remote:move', dx, dy }),
    click: (btn) => emit({ t: 'remote:click', btn }),
    scroll: (dx, dy) => emit({ t: 'remote:scroll', dx, dy }),
    nav: (dir) => emit({ t: 'remote:nav', dir }),
    type: (text) => emit({ t: 'remote:type', text }),
    key: (key) => emit({ t: 'remote:key', key }),
    pointer: (on) => emit({ t: 'remote:pointer', on }),
    helper: (body) => emit({ t: 'remote:helper', ...body }),
  }
}
