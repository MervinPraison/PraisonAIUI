// The chat's element renderer for `artifact` elements (aiui.canvas): an open
// draws nothing, a table or document goes to the chat Markdown renderer,
// code and media are drawn as those elements.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ElementPart from './ElementPart'

const html = (data: Record<string, unknown>) => renderToStaticMarkup(createElement(ElementPart, { data }))

test('artifact elements: open is invisible, tables and documents are markdown, code and images as themselves', () => {
  assert.equal(html({ type: 'artifact', key: 'sorting', action: 'open' }), '')
  assert.match(html({ type: 'artifact', key: 'sorting', kind: 'table', content: '| a |\n|---|\n| 1 |', action: 'upsert' }), /data-element="artifact"/)
  assert.equal(html({ type: 'artifact', key: 't', kind: 'table', action: 'upsert' }), '', 'no content, nothing to draw')
  assert.match(html({ type: 'artifact', key: 'app.py', kind: 'code', content: 'print(1)', action: 'upsert' }), /data-element="code"/)
  const img = html({ type: 'artifact', key: 'pic', kind: 'image', url: '/files/p.png', title: 'Picture', action: 'upsert' })
  // The media guard still applies (no window origin here: click to load).
  assert.match(img, /data-element="image"[\s\S]*Image from \/files\/p.png/)
  assert.match(html({ type: 'artifact', key: 'x', kind: 'artifact', url: '/f', action: 'upsert' }), /data-element="file"/, 'never recursive')
})
