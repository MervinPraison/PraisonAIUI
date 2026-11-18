// First-party browser plugins (src/builtin): they register through the public
// SDK object, once, and a broken one does not stop the others.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  activateBuiltins,
  BUILTIN_PLUGINS,
  installBuiltins,
  isBuiltinPage,
  resetBuiltinsForTests,
  type BuiltinPlugin,
} from '@/builtin'
import { sdkApi } from '@/sdk/install'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import { getPage } from '@/sdk/registry'
import { activateShell, getCommands, resetServicesForTests } from '@/sdk/services'
import { PageView } from '@/shell/PageView'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
}

test('built-in names are unique, namespaced and each one owns a page or is a service', () => {
  const names = BUILTIN_PLUGINS.map((b) => b.name)
  assert.equal(new Set(names).size, names.length)
  for (const b of BUILTIN_PLUGINS) {
    assert.match(b.name, /^builtin\.[a-z][a-z0-9-]*$/)
    assert.ok(b.pages.length > 0 || b.always, `${b.name} lists its pages or is marked always`)
  }
  const ids = BUILTIN_PLUGINS.flatMap((b) => b.pages)
  assert.equal(new Set(ids).size, ids.length, 'no page id is claimed twice')
})

test('the built-in layouts and their picker ship in the list (otherwise Rollup drops them)', () => {
  const names = BUILTIN_PLUGINS.map((b) => b.name)
  assert.deepEqual(names, ['builtin.chat', 'builtin.approvals', 'builtin.layouts', 'builtin.layout-guided', 'builtin.overview', 'builtin.sessions', 'builtin.agents', 'builtin.knowledge', 'builtin.logs', 'builtin.config', 'builtin.cron', 'builtin.connect', 'builtin.api-reference', 'builtin.artifacts'])
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
    {
      name: 'builtin.service',
      pages: [],
      always: true,
      activate(_sdk, ctx) {
        calls.push(['service', ...ctx.pageIds])
      },
    },
  ]
  const m = manifest([page('broken'), page('ok')])
  try {
    assert.deepEqual(activateBuiltins(m, sdkApi, plugins), ['builtin.ok', 'builtin.service'])
    assert.deepEqual(activateBuiltins(m, sdkApi, plugins), [], 'a second call activates nothing')
  } finally {
    console.error = original
  }
  assert.deepEqual(
    calls,
    [['ok'], ['service']],
    'only pages the manifest lists; an absent plugin is not activated, an `always` one is',
  )
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
  resetServicesForTests()
  const hidden = manifest([page('overview'), page('logs')])
  // The always-on services, and the React pages of the two pages it lists.
  assert.deepEqual(activateBuiltins(hidden), ['builtin.approvals', 'builtin.layouts', 'builtin.overview', 'builtin.logs'])
  assert.equal(getPage('chat'), undefined)
  assert.equal(getCommands().find((c) => c.id === 'chat.new'), undefined, 'no "New chat" without the chat page')
  const html = renderPage('chat', hidden)
  assert.match(html, /Page not found/)
  assert.match(html, /Go to overview/)
})

test('an app page that reuses the id keeps its own renderer', () => {
  resetBuiltinsForTests()
  const own = manifest([page('chat', { source: 'app', kind: 'blocks' })])
  assert.deepEqual(activateBuiltins(own), ['builtin.approvals', 'builtin.layouts'])
  assert.equal(getPage('chat'), undefined, 'the React chat does not shadow the app page')
})

test('installBuiltins queues on onActivate: nothing registers until the shell has the manifest', () => {
  resetBuiltinsForTests()
  resetServicesForTests()
  installBuiltins()
  installBuiltins() // idempotent
  assert.equal(getPage('chat'), undefined, 'not registered at install time')
  const m = manifest([page('overview'), page('chat')])
  activateShell(m)
  assert.ok(getPage('chat'), 'builtin.chat registered the page when the shell activated')
  const newChat = getCommands().find((c) => c.id === 'chat.new')
  assert.ok(newChat, 'builtin.chat contributes "New chat" to the command palette')
  assert.equal(newChat.title, 'New chat')
  assert.equal(newChat.group, 'Actions')
  assert.doesNotMatch(renderPage('chat', m), /Page not found/)
  assert.deepEqual(activateBuiltins(m), [], 'already active')
})

test("a layout's own pages activate only while the manifest lists them (the server lists them while that layout is offered)", () => {
  resetBuiltinsForTests()
  const guided = BUILTIN_PLUGINS.filter((b) => b.name === 'builtin.layout-guided')
  const registered: string[] = []
  const sdk = { ...sdkApi, registerPage: (id: string) => void registered.push(id) } as typeof sdkApi
  assert.deepEqual(activateBuiltins(manifest([page('chat')]), sdk, guided), [], 'Guided off: nothing registers')
  assert.deepEqual(
    activateBuiltins(manifest([page('chat'), page('start', { kind: 'native', layouts: ['guided'] }), page('templates', { kind: 'native', layouts: ['guided'] })]), sdk, guided),
    ['builtin.layout-guided'],
  )
  assert.deepEqual(registered, ['start', 'templates'])
  resetBuiltinsForTests()
})

test('builtin.artifacts registers its page, lazily, only while the manifest lists it (the record is on)', async () => {
  resetBuiltinsForTests()
  const artifacts = BUILTIN_PLUGINS.filter((b) => b.name === 'builtin.artifacts')
  const registered: [string, unknown][] = []
  const sdk = { ...sdkApi, registerPage: (id: string, c: unknown) => void registered.push([id, c]) } as typeof sdkApi
  assert.deepEqual(activateBuiltins(manifest([page('chat')]), sdk, artifacts), [], 'record off: nothing registers')
  assert.equal(registered.length, 0)
  const listed = page('artifacts', { kind: 'native', source: 'builtin.artifacts', layouts: ['chat-canvas'] })
  assert.deepEqual(activateBuiltins(manifest([page('chat'), listed]), sdk, artifacts), ['builtin.artifacts'])
  assert.equal(registered.length, 1)
  const [id, loader] = registered[0]
  assert.equal(id, 'artifacts')
  assert.equal(typeof loader, 'function', 'a loader, not the component: the page stays in its lazy chunk')
  const mod = (await (loader as () => Promise<{ default: unknown }>)()) as { default: unknown }
  assert.equal(typeof mod.default, 'function', 'the loader resolves to ArtifactsPage')
  resetBuiltinsForTests()
})

test('"Chat + Canvas" (chat-canvas) is the React chat in the app shell, never its vanilla view', () => {
  resetBuiltinsForTests()
  resetServicesForTests()
  const m = manifest([page('chat-canvas', { kind: 'legacy' })])
  assert.ok(activateBuiltins(m).includes('builtin.chat'))
  assert.ok(getPage('chat-canvas'), 'builtin.chat registered the React chat under chat-canvas')
  assert.equal(getCommands().find((c) => c.id === 'chat.new'), undefined, '"New chat" comes with the chat page only')
})
