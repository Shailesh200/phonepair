declare module 'phonepair-helper/server' {
  export const LOOPBACK: string
  export const DEFAULT_PORTS: readonly number[]
  export type Mod = 'cmd' | 'ctrl' | 'alt' | 'shift'
  export type Injector = {
    move(dx: number, dy: number): Promise<void>
    click(btn: 'left' | 'right'): Promise<void>
    scroll(dx: number, dy: number): Promise<void>
    key(key: string, mods: Mod[]): Promise<void>
    type(text: string): Promise<void>
    abs(x: number, y: number): Promise<void>
    btn(btn: 'left' | 'right', state: 'down' | 'up'): Promise<void>
    dbl(): Promise<void>
    release(): Promise<void>
    nudge(): Promise<void>
  }
  export type RunningHelper = {
    port: number
    host: string
    stopMover(): void
    close(): Promise<void>
  }
  export function startHelper(opts: {
    code: string
    inject: Injector
    ports?: readonly number[]
    log?: (line: string) => void
  }): Promise<RunningHelper>
}

declare module 'phonepair-helper/validate' {
  export function setDevOriginEnabled(enabled: boolean | null): void
}

declare module 'phonepair-helper/inject' {
  import type { Injector } from 'phonepair-helper/server'
  export function createNutInjector(): Injector
  export function nutNoop(): Promise<void>
  export function releaseModifiers(): Promise<void>
}
