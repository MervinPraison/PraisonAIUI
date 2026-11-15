// The composer's footer in a layout (host Pinned): no approval slot (every
// layout keeps the decision in its turn), nothing visible while connected.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatPresentation } from '@/sdk/layouts'
import { Pinned } from './host'

test('Pinned draws no approval slot for any thread variant', () => {
  for (const thread of ['steps', 'bubbles', 'quiet', 'dense'] as const) {
    const html = renderToStaticMarkup(createElement(Pinned, { presentation: { chat: { thread, approvals: 'card' } as ChatPresentation } }))
    assert.doesNotMatch(html, /data-chat-pinned/, thread)
  }
})
