// The layout chat's connection banner: nothing while connected or on the
// first handshake; after a drop, what still works and Retry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { bannerFor, ConnectionBanner } from './ConnectionBanner'
import type { AiuiTransport } from '../transports'

test('bannerFor: none while open or before the first drop', () => {
  assert.equal(bannerFor('open', true, true), null)
  assert.equal(bannerFor('connecting', false, true), null, 'the first handshake')
  assert.equal(bannerFor(undefined, true, true), null)
})

test('bannerFor: after a drop, reconnecting, or what still works with Retry', () => {
  assert.deepEqual(bannerFor('connecting', true, true), { text: 'Reconnecting…', retry: false, busy: true })
  assert.match(bannerFor('closed', true, true)!.text, /still send/)
  assert.equal(bannerFor('closed', true, true)!.retry, true)
  assert.match(bannerFor('closed', true, false)!.text, /Disconnected/)
})

test('rendered: nothing for a socket never opened, nor for an open one', () => {
  const t = (status: 'open' | 'closed') =>
    ({ kind: 'ws', status, httpFallback: true, reconnect() {}, onStatus: () => () => {} }) as unknown as AiuiTransport
  assert.equal(renderToStaticMarkup(createElement(ConnectionBanner, { transport: t('closed') })), '', 'idle before the first handshake')
  assert.equal(renderToStaticMarkup(createElement(ConnectionBanner, { transport: t('open') })), '')
})
