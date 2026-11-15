// A new chat in a layout (the hero) and the setup banner above the composer.
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { EmptyHero, HERO_PROMISE, heroMark } from './EmptyHero'
import { loadProviderHealth, resetProviderHealthForTests, setupNotice } from './SetupBanner'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  resetProviderHealthForTests()
})

test('heroMark: an image path or URL, else the text mascot, else none', () => {
  assert.deepEqual(heroMark('/logo.svg'), { kind: 'img', src: '/logo.svg' })
  assert.deepEqual(heroMark('https://x.test/l.png'), { kind: 'img', src: 'https://x.test/l.png' })
  assert.deepEqual(heroMark('AI'), { kind: 'text', text: 'AI' })
  assert.equal(heroMark(''), null)
  assert.equal(heroMark(undefined), null)
})

test('the hero: a 44px wordmark, the promise line, then the starters', () => {
  const html = renderToStaticMarkup(createElement(EmptyHero, null, createElement('div', { id: 'starters' })))
  assert.match(html, /data-chat-hero=""/)
  assert.match(html, /<h2[^>]*text-\[44px\][^>]*>PraisonAI<\/h2>/)
  assert.ok(html.includes(HERO_PROMISE))
  assert.ok(html.indexOf('data-chat-hero') < html.indexOf('id="starters"'))
})

test('setupNotice: a missing key, a provider that does not answer, otherwise nothing', () => {
  assert.deepEqual(setupNotice({ status: 'ok', api_key: 'missing' }), { kind: 'key', text: 'Add an API key to start chatting.' })
  assert.equal(setupNotice({ status: 'ok', api_key: 'set' }), null)
  assert.equal(setupNotice({ status: 'ok' }), null, 'a provider that does not say: unknown, no banner')
  assert.equal(setupNotice(null), null)
  assert.deepEqual(setupNotice({ status: 'error', provider: 'Gateway', detail: 'connection refused' }), { kind: 'down', text: 'Gateway is not answering: connection refused' })
})

test('the health is fetched once per page view; a failed request is no banner', async () => {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return { ok: true, json: async () => ({ status: 'ok', api_key: 'missing' }) } as Response
  }) as typeof fetch
  assert.equal((await loadProviderHealth())?.api_key, 'missing')
  await loadProviderHealth()
  assert.equal(calls, 1)
  resetProviderHealthForTests()
  globalThis.fetch = (async () => {
    throw new TypeError('offline')
  }) as typeof fetch
  assert.equal(await loadProviderHealth(), null)
})
