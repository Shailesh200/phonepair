import { CODE_ALPHABET, isValidPairCode, normalizePairCode } from './code'

export const CODE_LEN = 6

export function emptyCells(): string[] {
  return Array.from({ length: CODE_LEN }, () => '')
}

export function cellsFromCode(code: string): string[] {
  const n = normalizePairCode(code)
  const cells = emptyCells()
  for (let i = 0; i < Math.min(n.length, CODE_LEN); i++) cells[i] = n[i]
  return cells
}

export function codeFromCells(cells: string[]): string {
  return normalizePairCode(cells.join(''))
}

export function applyCharToCells(cells: string[], index: number, ch: string): { cells: string[]; next: number } {
  const c = ch.toUpperCase()
  if (!c || !CODE_ALPHABET.includes(c)) return { cells, next: index }
  const out = [...cells]
  out[index] = c
  const next = Math.min(index + 1, CODE_LEN - 1)
  return { cells: out, next }
}

export function applyBackspace(cells: string[], index: number): { cells: string[]; next: number } {
  const out = [...cells]
  if (out[index]) {
    out[index] = ''
    return { cells: out, next: index }
  }
  if (index > 0) {
    out[index - 1] = ''
    return { cells: out, next: index - 1 }
  }
  return { cells: out, next: index }
}

export function applyPaste(cells: string[], raw: string, startIndex = 0): { cells: string[]; next: number; code: string } {
  const normalized = normalizePairCode(raw)
  const out = emptyCells()
  for (let i = 0; i < normalized.length && i < CODE_LEN; i++) out[i] = normalized[i]
  const code = codeFromCells(out)
  const next = Math.min(normalized.length, CODE_LEN - 1)
  return { cells: out, next: Math.max(startIndex, next), code }
}

export { isValidPairCode, normalizePairCode }
