// The classic sidebar's page icon: an app page's lucide name, emoji or image
// URL draws, not the generic FileText.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageIcon } from './PageIcon'

const html = (page: { icon?: string; navIcon?: string }) => renderToStaticMarkup(createElement(PageIcon, { page }))

test('PageIcon: static map, then the page declared icon, then FileText', () => {
  assert.match(html({ navIcon: 'bot' }), /lucide-bot/)
  const users = html({ icon: 'users' })
  assert.match(users, /^<svg[^>]*viewBox="0 0 24 24"/)
  assert.doesNotMatch(users, /lucide-file-text/, 'a lucide name outside the static map is not the generic icon')
  assert.match(html({ icon: '\u{1F3AC}' }), /\u{1F3AC}/u)
  assert.match(html({ icon: 'https://example.com/i.png' }), /<img[^>]*src="https:\/\/example.com\/i.png"/)
  assert.match(html({ icon: '\u{1F4C4}' }), /lucide-file-text/, 'the server default draws the generic icon')
  assert.match(html({}), /lucide-file-text/)
})
