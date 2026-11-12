import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  assertPairCodeDomContract,
  pairCodePlainText,
  pairCodeSpanChars,
} from './pairCodeDisplay.ts'

describe('pair code display', () => {
  it('span chars concatenate to the code without a separator in textContent', () => {
    const code = 'BRV5S72'
    const chars = pairCodeSpanChars(code)
    assert.deepEqual(chars, [...code])
    assert.equal(chars.join(''), code)
  })

  it('data-pair-code-raw and stripped textContent equal the code', () => {
    const code = 'ABC2DE'
    const markup = renderToStaticMarkup(
      React.createElement(
        'div',
        {
          className: 'code code-click',
          'data-testid': 'pair-code',
          'data-pair-code-raw': code,
        },
        ...pairCodeSpanChars(code).map((c, i) => React.createElement(
          'span',
          { key: i, className: i === 2 ? 'code-mid' : undefined },
          c,
        )),
      ),
    )
    const text = markup.replace(/<[^>]+>/g, '')
    assertPairCodeDomContract(code, text, code)
    assert.equal(pairCodePlainText(text), code)
  })
})
