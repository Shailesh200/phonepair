import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

describe('laptop mouse mover commands', () => {
  it('sends t:mover for the toggle and the interval', () => {
    const src = readFileSync(join(process.cwd(), 'src/features/remote/index.tsx'), 'utf8')
    assert.match(src, /sendHelper\(\{ t: 'mover', \.\.\.moverToggleCommand\(mover\) \}\)/)
    assert.match(src, /sendHelper\(\{ t: 'mover', \.\.\.moverIntervalCommand\(interval\) \}\)/)
    assert.equal(src.includes('sendHelper(moverToggleCommand('), false)
    assert.equal(src.includes('sendHelper(moverIntervalCommand('), false)
  })
})
