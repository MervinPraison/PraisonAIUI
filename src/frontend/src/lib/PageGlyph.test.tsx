// lib/PageGlyph: the page icons a frame's static lucide map does not have
// (an app page's `@aiui.page(icon=...)`): any lucide name, an image URL or an emoji.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PageGlyph } from './PageGlyph'
import { pageGlyphSource } from './pageGlyphSource'

const fallback = createElement('span', { 'data-fallback': '' }, 'X')
const html = (navIcon?: string, icon?: string) => renderToStaticMarkup(createElement(PageGlyph, { navIcon, icon, className: 'size-4', fallback }))

test('pageGlyphSource: lucide names, image URLs and emoji; navIcon before icon', () => {
  assert.deepEqual(pageGlyphSource(undefined, 'users'), { kind: 'name', name: 'users' })
  assert.deepEqual(pageGlyphSource(undefined, '  Film '), { kind: 'name', name: 'film' })
  assert.deepEqual(pageGlyphSource('globe', '\u{1F30D}'), { kind: 'name', name: 'globe' }, 'navIcon wins over the legacy emoji')
  assert.deepEqual(pageGlyphSource(undefined, '\u{1F30D}'), { kind: 'emoji', text: '\u{1F30D}' })
  assert.deepEqual(pageGlyphSource(undefined, '\u{1F468}‍\u{1F4BB}'), { kind: 'emoji', text: '\u{1F468}‍\u{1F4BB}' })
  assert.deepEqual(pageGlyphSource(undefined, 'https://cdn.example.com/i.svg'), { kind: 'url', src: 'https://cdn.example.com/i.svg' })
  assert.deepEqual(pageGlyphSource(undefined, '/static/logo.png'), { kind: 'url', src: '/static/logo.png' })
})

test('pageGlyphSource: nothing for the server default, unsafe URLs and junk', () => {
  assert.equal(pageGlyphSource(undefined, '\u{1F4C4}'), undefined, 'the @aiui.page default means no icon chosen')
  assert.equal(pageGlyphSource(undefined, 'javascript:alert(1)'), undefined)
  assert.equal(pageGlyphSource(undefined, 'data:image/svg+xml,<svg onload=x>'), undefined)
  assert.equal(pageGlyphSource(undefined, '//evil.example/x.png'), undefined, 'no protocol-relative URLs')
  assert.equal(pageGlyphSource(undefined, '<img src=x>'), undefined)
  assert.equal(pageGlyphSource(undefined, ''), undefined)
  assert.equal(pageGlyphSource(), undefined)
})

test('PageGlyph: a lazy lucide frame, an image, a muted emoji, else the fallback', () => {
  const lazy = html(undefined, 'users')
  assert.match(lazy, /^<svg[^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"/)
  assert.match(lazy, /class="size-4"/)
  const img = html(undefined, '/static/logo.png')
  assert.match(img, /<img[^>]*src="\/static\/logo.png"/)
  assert.match(img, /alt=""/)
  const emoji = html(undefined, '\u{1F3AC}')
  assert.match(emoji, /\u{1F3AC}/u)
  assert.match(emoji, /grayscale/)
  assert.match(html(undefined, '\u{1F4C4}'), /data-fallback/)
  assert.match(html(), /data-fallback/)
})
