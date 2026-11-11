import { timingSafeEqual } from 'node:crypto'

export const MAX_ATTEMPTS = 5
export const LOCK_MS = 60_000

export type Gate = {
  attempts: number
  lockedUntil: number
}

export function createGate(): Gate {
  return { attempts: 0, lockedUntil: 0 }
}

/** True while a lockout is active. An expired lock resets the attempt counter. */
export function isLocked(gate: Gate, now: number): boolean {
  if (gate.lockedUntil !== 0 && now >= gate.lockedUntil) {
    gate.lockedUntil = 0
    gate.attempts = 0
  }
  return gate.lockedUntil > now
}

export function noteFailure(gate: Gate, now: number): void {
  if (isLocked(gate, now)) return
  gate.attempts += 1
  if (gate.attempts >= MAX_ATTEMPTS) {
    gate.attempts = 0
    gate.lockedUntil = now + LOCK_MS
  }
}

export function noteSuccess(gate: Gate): void {
  gate.attempts = 0
  gate.lockedUntil = 0
}

export function codesMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}
