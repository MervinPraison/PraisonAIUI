// The composer's model button: the configured model (runtime, else defaults),
// a labelled ghost button; nothing when neither names a model.
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadModelName, ModelButton, resetModelNameForTests } from './ComposerModel'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  resetModelNameForTests()
})

const respond = (bodies: Record<string, unknown>) => {
  const seen: string[] = []
  globalThis.fetch = (async (url: string) => {
    seen.push(url)
    const body = bodies[url]
    return { ok: body !== undefined, json: async () => body } as Response
  }) as typeof fetch
  return seen
}

test('the runtime config names the model', async () => {
  const seen = respond({ '/api/config/runtime': { config: { model: { name: 'gpt-4o' } } } })
  assert.equal(await loadModelName(), 'gpt-4o')
  assert.deepEqual(seen, ['/api/config/runtime'])
})

test('without one in the runtime config, the defaults do; once per page view', async () => {
  const seen = respond({ '/api/config/runtime': { config: {} }, '/api/config/defaults': { defaults: { model: { name: 'gpt-4o-mini' } } } })
  assert.equal(await loadModelName(), 'gpt-4o-mini')
  assert.equal(await loadModelName(), 'gpt-4o-mini')
  assert.deepEqual(seen, ['/api/config/runtime', '/api/config/defaults'])
})

test('no route, no model', async () => {
  respond({})
  assert.equal(await loadModelName(), null)
})

test('the button says which model and that it changes it', () => {
  const html = renderToStaticMarkup(createElement(ModelButton, { name: 'gpt-4o-mini' }))
  assert.match(html, /<button type="button" data-composer-model="" aria-label="Model: gpt-4o-mini\. Change model"/)
  assert.match(html, /<span>gpt-4o-mini<\/span>/)
})
