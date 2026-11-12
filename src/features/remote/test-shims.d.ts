declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
declare module 'node:test' {
  export function describe(name: string, fn: () => void): void
  export function it(name: string, fn: () => Promise<void> | void): void
}
