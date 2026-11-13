// First-party browser plugins (src/builtin): they register through the public
// SDK object, once, and a broken one does not stop the others.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { activateBuiltins, BUILTIN_PLUGINS, isBuiltinPage, resetBuiltinsForTests, type BuiltinPlugin } from '@/builtin'
import { sdkApi } from '@/sdk/install'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import { getPage } from '@/sdk/registry'
import { PageView } from '@/shell/PageView'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
}

test('built-in names are unique, namespaced and each one owns at least one page', () => {
  const names = BUILTIN_PLUGINS.map((b) => b.name)
  assert.equal(new Set(names).size, names.length)
  for (const b of BUILTIN_PLUGINS) {
    assert.match(b.name, /^builtin\.[a-z][a-z0-9-]*$/)
    assert.ok(b.pages.length > 0, `${b.name} lists its pages`)
  }
  const ids = BUILTIN_PLUGINS.flatMap((b) => b.pages)
  assert.equal(new Set(ids).size, ids.length, 'no page id is claimed twice')
})

const page = (id: string, extra: Partial<ShellPage> = {}): ShellPage => ({
  id,
  title: id,
  kind: 'legacy',
  source: 'builtin',
  ...extra,
})

const manifest = (pages: ShellPage[]): ShellManifest => ({
  sdk: 1,
  version: '0.0.0',
  style: 'app',
  site: {},
  layout: {},
  pages,
  blocks: [],
  toolRenderers: [],
  plugins: [],
  legacy: { customJs: null, viewsBase: '/plugins/views/' },
})

function renderPage(pageId: string, m: ShellManifest): string {
  return renderToStaticMarkup(
    createElement(PageView, {
      pageId,
      page: m.pages.find((p) => p.id === pageId),
      pluginsSettled: true,
      fullBleed: false,
      firstPage: m.pages[0],
    }),
  )
}

test('activation hands each built-in the public sdk and its listed pages, once, and isolates a failure', () => {
  resetBuiltinsForTests()
  const calls: string[][] = []
  const errors: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => void errors.push(args)
  const plugins: BuiltinPlugin[] = [
    {
      name: 'builtin.broken',
      pages: ['broken'],
      activate() {
        throw new Error('boom')
      },
    },
    {
      name: 'builtin.ok',
      pages: ['ok', 'ok-hidden'],
      activate(sdk, ctx) {
        assert.equal(sdk, sdkApi)
        calls.push([...ctx.pageIds])
      },
    },
    {
      name: 'builtin.absent',
      pages: ['absent'],
      activate() {
        calls.push(['absent'])
      },
    },
  ]
  const m = manifest([page('broken'), page('ok')])
  try {
    assert.deepEqual(activateBuiltins(m, sdkApi, plugins), ['builtin.ok'])
    assert.deepEqual(activateBuiltins(m, sdkApi, plugins), [], 'a second call activates nothing')
  } finally {
    console.error = original
  }
  assert.deepEqual(calls, [['ok']], 'only pages the manifest lists; an absent plugin is not activated')
  assert.equal(errors.length, 1)
  assert.match(String(errors[0][0]), /builtin\.broken failed to activate/)
})

test('a page id taken over by the app or a plugin is not a built-in page', () => {
  assert.equal(isBuiltinPage(page('chat')), true)
  assert.equal(isBuiltinPage(page('chat', { source: undefined })), true, 'older servers send no source')
  assert.equal(isBuiltinPage(page('chat', { source: 'builtin.chat' })), true)
  assert.equal(isBuiltinPage(page('chat', { source: 'app', kind: 'blocks' })), false)
  assert.equal(isBuiltinPage(page('chat', { source: 'plugin:mychat', kind: 'react' })), false)
})

// Order matters below: the registry has no unregister, so the "hidden" cases
// run before the chat page is registered for the first time.

test('a built-in page hidden by set_pages is not registered and renders "Page not found"', () => {
  resetBuiltinsForTests()
  const hidden = manifest([page('overview'), page('logs')])
  assert.deepEqual(activateBuiltins(hidden), [])
  assert.equal(getPage('chat'), undefined)
  const html = renderPage('chat', hidden)
  assert.match(html, /Page not found/)
  assert.match(html, /Go to overview/)
})

test('an app page that reuses the id keeps its own renderer', () => {
  resetBuiltinsForTests()
  const own = manifest([page('chat', { source: 'app', kind: 'blocks' })])
  assert.deepEqual(activateBuiltins(own), [])
  assert.equal(getPage('chat'), undefined, 'the React chat does not shadow the app page')
})

test('with chat in the manifest, builtin.chat registers it through the SDK registry', () => {
  resetBuiltinsForTests()
  const m = manifest([page('overview'), page('chat')])
  assert.deepEqual(activateBuiltins(m), ['builtin.chat'])
  assert.ok(getPage('chat'), 'chat resolves through the registry')
  assert.doesNotMatch(renderPage('chat', m), /Page not found/)
})
