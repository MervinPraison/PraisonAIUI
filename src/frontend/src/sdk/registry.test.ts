// Contract tests for sdk/registry.ts and sdk/manifest.ts (WP0a).
// Uses the `@/` alias and extensionless imports on purpose: scripts/run-tests.mjs
// bundles every test with esbuild, which Node's type stripping alone cannot do.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, Suspense } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  getBlock,
  getPage,
  getSlot,
  getToolRenderers,
  registerBlock,
  registerPage,
  registerSlot,
  registerToolRenderer,
  subscribe,
  type BlockComponent,
  type PageComponent,
} from '@/sdk/registry'
import { normalizeManifest, SDK_EXPORTS, SHELL_EXTERNALS, type ShellPage } from '@/sdk/manifest'

const page: ShellPage = { id: 'p', title: 'P', kind: 'react' }

test('registerPage stores a function component as-is and notifies subscribers', () => {
  let calls = 0
  const off = subscribe(() => {
    calls += 1
  })
  function Hello({ page }: { page: ShellPage }) {
    return createElement('span', null, `hello ${page.title}`)
  }
  registerPage('hello', Hello)
  assert.equal(getPage('hello'), Hello)
  assert.equal(calls, 1)
  registerPage('hello', Hello) // same component: no change, no notification
  assert.equal(calls, 1)
  off()
  registerPage('hello2', Hello)
  assert.equal(calls, 1, 'unsubscribed listener must not fire')
  assert.equal(renderToStaticMarkup(createElement(Hello, { page })), '<span>hello P</span>')
})

test('registerPage treats a zero-arg arrow returning import() as a lazy loader', async () => {
  function Lazy({ page }: { page: ShellPage }) {
    return createElement('b', null, page.id)
  }
  registerPage('lazy', () => Promise.resolve({ default: Lazy as PageComponent }))
  const C = getPage('lazy')
  assert.ok(C)
  assert.notEqual(C, Lazy)
  // React.lazy object; resolve it the way React would.
  const payload = (C as unknown as { _payload: unknown; _init: (p: unknown) => unknown })
  try {
    payload._init(payload._payload)
  } catch (thenable) {
    await thenable
  }
  const resolved = payload._init(payload._payload)
  assert.equal(resolved, Lazy)
  const html = renderToStaticMarkup(createElement(Suspense, { fallback: 'x' }, createElement(C!, { page })))
  assert.equal(html, '<b>p</b>')
})

test('blocks, tool renderers and slots round-trip; tool renderer snapshot is stable', () => {
  const Block = () => null
  registerBlock('metric', Block)
  assert.equal(getBlock('metric'), Block)
  assert.equal(getBlock('missing'), undefined)

  const Weather = () => null
  registerToolRenderer('get_weather', Weather)
  const a = getToolRenderers()
  assert.equal(a.get_weather, Weather)
  assert.equal(getToolRenderers(), a, 'snapshot identity is stable without changes')
  registerSlot('header.right', Weather)
  assert.notEqual(getToolRenderers(), a, 'snapshot is rebuilt after any registry change')
  assert.equal(getSlot('header.right'), Weather)
})

test('registration rejects bad ids and non-components', () => {
  assert.throws(() => registerPage('', (() => null) as unknown as PageComponent), TypeError)
  assert.throws(() => registerBlock('x', 42 as unknown as BlockComponent), TypeError)
})

test('normalizeManifest fills defaults and rejects partial boot copies', () => {
  assert.equal(normalizeManifest({ sdk: 1, version: '1', style: 'app' }), null)
  assert.equal(normalizeManifest(null), null)
  const m = normalizeManifest({ pages: [{ id: 'chat', title: 'Chat', kind: 'react' }, { nope: 1 }] })
  assert.ok(m)
  assert.deepEqual(m.pages.map((p) => p.id), ['chat'])
  assert.deepEqual(m.blocks, [])
  assert.deepEqual(m.legacy, { customJs: null, viewsBase: '/plugins/views/' })
})

test('SDK_EXPORTS and SHELL_EXTERNALS are frozen-shape lists', () => {
  assert.equal(new Set(SDK_EXPORTS).size, SDK_EXPORTS.length)
  for (const name of SDK_EXPORTS) assert.match(name, /^[A-Za-z_$][\w$]*$/)
  assert.deepEqual([...SHELL_EXTERNALS].sort(), ['@aiui/sdk', 'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'])
})
