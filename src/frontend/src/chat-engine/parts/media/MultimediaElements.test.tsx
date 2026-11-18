/**
 * ElementRenderer (the chat engine's media; the classic chat imports it
 * through chat/): one element that fails to render shows the fallback card
 * through ElementBoundary, an error boundary. The JSX used to
 * sit in a try/catch, which cannot catch a child's render error.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ElementBoundary, ElementRenderer } from './MultimediaElements'

test('ElementRenderer renders a known element inside the boundary', () => {
  const html = renderToStaticMarkup(createElement(ElementRenderer, { element: { type: 'image', url: '/a.png', alt: 'chart' } }))
  assert.match(html, /<img[^>]*src="\/a\.png"/)
  assert.doesNotMatch(html, /Failed to render element/)
})

test('ElementRenderer renders nothing for a value without a type', () => {
  assert.equal(renderToStaticMarkup(createElement(ElementRenderer, { element: {} })), '')
})

test('ElementBoundary: a render error switches it to the fallback card', () => {
  assert.deepEqual(ElementBoundary.getDerivedStateFromError(), { failed: true })
  const boundary = new ElementBoundary({ className: 'max-w-sm', children: createElement('p', null, 'ok') })
  assert.equal(renderToStaticMarkup(boundary.render()), '<p>ok</p>')
  boundary.state = { failed: true }
  const html = renderToStaticMarkup(boundary.render())
  assert.match(html, /Failed to render element/)
  assert.match(html, /max-w-sm/)
})
