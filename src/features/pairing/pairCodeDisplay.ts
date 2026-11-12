/** Six pairing-code characters for DOM text nodes (visual separator is CSS-only). */
export function pairCodeSpanChars(code: string): string[] {
  return [...code]
}

export function pairCodePlainText(textContent: string): string {
  return textContent.replace(/\s+/g, '')
}

export function assertPairCodeDomContract(code: string, textContent: string, rawAttr: string | null): void {
  const plain = pairCodePlainText(textContent)
  if (plain !== code) {
    throw new Error(`pair-code textContent must be six chars (got "${plain}")`)
  }
  if (rawAttr !== code) {
    throw new Error(`data-pair-code-raw must match code (got "${rawAttr}")`)
  }
}
