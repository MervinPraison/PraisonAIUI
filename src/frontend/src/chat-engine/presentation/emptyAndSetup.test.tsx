// A new chat in a layout (the hero) and the setup banner above the composer.
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatPresentation } from '@/sdk/layouts'
import { EmptyHero, HERO_PROMISE, heroMark } from './EmptyHero'
import { Empty } from './host'
import { loadProviderHealth, resetProviderHealthForTests, setupNotice } from './SetupBanner'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  resetProviderHealthForTests()
})

test('heroMark: an image path or URL, plain text letters, else the PraisonAI glyph (emoji mascots too)', () => {
  assert.deepEqual(heroMark('/logo.svg'), { kind: 'img', src: '/logo.svg' })
  assert.deepEqual(heroMark('https://x.test/l.png'), { kind: 'img', src: 'https://x.test/l.png' })
  assert.deepEqual(heroMark('AI'), { kind: 'text', text: 'AI' })
  assert.deepEqual(heroMark(''), { kind: 'glyph' })
  assert.deepEqual(heroMark(undefined), { kind: 'glyph' })
  assert.deepEqual(heroMark('\u{1F680}'), { kind: 'glyph' })
})

test('the hero: a 44px wordmark (smaller on a phone), the promise line, then the starters', () => {
  const html = renderToStaticMarkup(createElement(EmptyHero, null, createElement('div', { id: 'starters' })))
  assert.match(html, /data-chat-hero=""/)
  assert.match(html, /<h2[^>]*text-\[length:clamp\(2rem,9vw,2\.75rem\)\][^>]*>\s*PraisonAI\s*<\/h2>/)
  assert.ok(html.includes(HERO_PROMISE))
  assert.ok(html.indexOf('data-chat-hero') < html.indexOf('id="starters"'))
})

test('the hero: a name too long for one row wraps below the mark, centred, instead of beside it', () => {
  const html = renderToStaticMarkup(createElement(EmptyHero, null, createElement('div', { id: 'starters' })))
  const brand = /<div class="([^"]*)" data-chat-hero-brand="">/.exec(html)
  assert.ok(brand, 'the mark and the name share one brand row')
  for (const c of ['flex-wrap', 'justify-center', 'max-w-full']) assert.ok(brand[1].split(' ').includes(c), `brand row has ${c}`)
  const h2 = /<h2 class="([^"]*)"/.exec(html)?.[1].split(' ') ?? []
  for (const c of ['text-center', 'text-balance', 'min-w-0']) assert.ok(h2.includes(c), `the name has ${c}`)
  assert.match(html, /data-brand-tile="" class="[^"]*shrink-0/, 'the mark keeps its size')
})

test('the hero with the app greeting (@aiui.welcome): the greeting replaces the promise line, as text', () => {
  const html = renderToStaticMarkup(createElement(EmptyHero, { welcome: 'Hi <b>there</b>', children: createElement('div', { id: 'starters' }) }))
  assert.match(html, /<p[^>]*data-welcome=""[^>]*>Hi &lt;b&gt;there&lt;\/b&gt;<\/p>/)
  assert.ok(!html.includes(HERO_PROMISE))
  assert.match(html, /<h2[^>]*>\s*PraisonAI\s*<\/h2>/, 'the wordmark stays')
  assert.ok(html.indexOf('data-welcome') < html.indexOf('id="starters"'), 'the starters stay, under the greeting')
})

test('Empty in a layout: the greeting shows in the hero, and under the heading of a layout with its own empty region', () => {
  const presentation = { chat: { thread: 'bubbles' } as ChatPresentation, sessionId: null }
  const children = createElement('div', { id: 'starters' })
  const hero = renderToStaticMarkup(createElement(Empty, { presentation, welcome: 'Hello from on_welcome', children }))
  assert.match(hero, /data-chat-hero=""/)
  assert.match(hero, /data-welcome="">Hello from on_welcome</)
  assert.ok(hero.includes('id="starters"'))
  const plain = renderToStaticMarkup(createElement(Empty, { presentation, children }))
  assert.ok(plain.includes(HERO_PROMISE), 'no greeting: the promise line, as before')
  assert.doesNotMatch(plain, /data-welcome/)
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
