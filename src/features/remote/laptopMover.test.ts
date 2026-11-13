import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

describe('laptop mouse mover commands', () => {
  it('sends t:mover for the toggle, and the nudge interval is fixed at 3s', () => {
    const src = readFileSync(join(process.cwd(), 'src/features/remote/index.tsx'), 'utf8')
    const mover = readFileSync(join(process.cwd(), 'src/features/screen/mover.ts'), 'utf8')
    assert.match(src, /sendHelper\(\{ t: 'mover', \.\.\.moverToggleCommand\(mover\) \}\)/)
    assert.equal(src.includes('moverIntervalCommand'), false)
    assert.equal(src.includes('sendHelper(moverToggleCommand('), false)
    assert.match(mover, /MOVER_DEFAULT_INTERVAL: MoverInterval = '3s'/)
  })
})
