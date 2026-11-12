import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConnRelayNote, connRelayNoteVisible } from './ui.tsx'

describe('ConnRelayNote', () => {
  it('renders conn-relay testid only when connViaRelay is true', () => {
    assert.equal(connRelayNoteVisible(true), true)
    assert.equal(connRelayNoteVisible(false), false)
    assert.equal(connRelayNoteVisible(null), false)
    const link = {
      connViaRelay: true as boolean | null,
      subscribe: () => () => {},
    }
    const html = renderToStaticMarkup(<ConnRelayNote link={link as any} />)
    assert.match(html, /data-testid="conn-relay"/)
    assert.match(html, /Connected via relay/)
    const hidden = renderToStaticMarkup(
      <ConnRelayNote link={{ connViaRelay: false, subscribe: () => () => {} } as any} />,
    )
    assert.equal(hidden, '')
  })
})
