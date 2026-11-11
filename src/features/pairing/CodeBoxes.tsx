import React, { useEffect, useRef, useState } from 'react'
import {
  CODE_LEN,
  applyBackspace,
  applyCharToCells,
  applyPaste,
  codeFromCells,
  emptyCells,
  isValidPairCode,
} from './codeBoxes'

export function CodeBoxes({
  onComplete,
  onChange,
  autoFocus,
}: {
  onComplete: (code: string) => void
  onChange?: () => void
  autoFocus?: boolean
}) {
  const [cells, setCells] = useState(emptyCells)
  const [focusIx, setFocusIx] = useState(0)
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const sent = useRef('')

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  const update = (nextCells: string[], nextFocus: number) => {
    setCells(nextCells)
    setFocusIx(nextFocus)
    onChange?.()
    const code = codeFromCells(nextCells)
    if (isValidPairCode(code) && sent.current !== code) {
      sent.current = code
      onComplete(code)
    }
  }

  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      const r = applyBackspace(cells, i)
      update(r.cells, r.next)
      refs.current[r.next]?.focus()
      return
    }
    if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault()
      refs.current[i - 1]?.focus()
      return
    }
    if (e.key === 'ArrowRight' && i < CODE_LEN - 1) {
      e.preventDefault()
      refs.current[i + 1]?.focus()
    }
  }

  const onChar = (i: number, raw: string) => {
    if (!raw) return
    const ch = raw.slice(-1)
    const r = applyCharToCells(cells, i, ch)
    update(r.cells, r.next)
    refs.current[r.next]?.focus()
  }

  const onPasteBox = (i: number, e: React.ClipboardEvent) => {
    e.preventDefault()
    sent.current = ''
    const r = applyPaste(cells, e.clipboardData.getData('text'), i)
    setCells(r.cells)
    setFocusIx(r.next)
    onChange?.()
    refs.current[r.next]?.focus()
    if (isValidPairCode(r.code)) {
      sent.current = r.code
      onComplete(r.code)
    }
  }

  return (
    <div className="code-boxes" role="group" aria-label="6-character pairing code">
      {cells.map((c, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el }}
          className="code-box"
          data-testid={i === 0 ? 'code-input' : `code-box-${i}`}
          type="text"
          inputMode={i === 0 ? 'text' : 'text'}
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={1}
          value={c}
          aria-label={i === 0 ? 'Pairing code character 1 of 6' : `Character ${i + 1}`}
          onFocus={() => setFocusIx(i)}
          onChange={(e) => onChar(i, e.target.value)}
          onKeyDown={(e) => onKey(i, e)}
          onPaste={(e) => onPasteBox(i, e)}
        />
      ))}
    </div>
  )
}
