// npm test -- chat-engine/presentation/pinned
// The place above the composer where the 'steps' thread pins open approvals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatPresentation } from '@/sdk/layouts'
import { Pinned } from './host'
import { getPinnedSlot, pinnedSlotRef, pinsGates } from './pinned'

const el = () => ({}) as HTMLElement

test('only the steps thread pins gates (its turn header owns the steps)', () => {
  assert.equal(pinsGates({ thread: 'steps' }), true)
  for (const thread of ['bubbles', 'quiet', 'dense', undefined] as const) assert.equal(pinsGates({ thread }), false, String(thread))
})

test('the slot is the mounted element; its cleanup lets go only of itself', () => {
  const a = el()
  const b = el()
  const releaseA = pinnedSlotRef(a)
  assert.equal(getPinnedSlot(), a)
  const releaseB = pinnedSlotRef(b) // a second thread mounted before the first went
  assert.equal(getPinnedSlot(), b)
  releaseA?.()
  assert.equal(getPinnedSlot(), b, 'the older slot going does not drop the newer one')
  releaseB?.()
  assert.equal(getPinnedSlot(), null)
  assert.equal(pinnedSlotRef(null), undefined)
})

test('Pinned draws the place only for a thread that pins', () => {
  const render = (chat: ChatPresentation) => renderToStaticMarkup(createElement(Pinned, { presentation: { chat } }))
  assert.equal(render({ thread: 'bubbles', approvals: 'card' }), '')
  const html = render({ thread: 'steps', approvals: 'card' })
  assert.match(html, /data-chat-pinned/)
  assert.match(html, /role="region"/)
})
