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
  DEFAULT_SLOT_ID,
  getSlot,
  getSlotContributions,
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

test('a slot takes several contributions, ordered by `order` then by registration', () => {
  const A = () => null
  const B = () => null
  const C = () => null
  const slot = 'test:multi'
  assert.deepEqual(getSlotContributions(slot), [])
  assert.equal(getSlotContributions(slot), getSlotContributions('test:other'), 'one shared empty list')

  registerSlot(slot, B, { id: 'plugin-b', order: 20 })
  registerSlot(slot, A, { id: 'plugin-a', order: 10 })
  registerSlot(slot, C, { id: 'plugin-c', order: 20 })
  assert.deepEqual(
    getSlotContributions(slot).map((c) => [c.id, c.order, c.component]),
    [
      ['plugin-a', 10, A],
      ['plugin-b', 20, B],
      ['plugin-c', 20, C],
    ],
  )
  assert.equal(getSlot(slot), A, 'getSlot returns the first contribution')

  const snapshot = getSlotContributions(slot)
  assert.equal(getSlotContributions(slot), snapshot, 'stable identity without changes')
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot[0]))

  let changes = 0
  const off = subscribe(() => (changes += 1))
  registerSlot(slot, B, { id: 'plugin-b', order: 20 })
  assert.equal(changes, 0, 'an identical registration is a no-op')
  registerSlot(slot, B, { id: 'plugin-b', order: 5 })
  assert.equal(changes, 1)
  off()
  assert.notEqual(getSlotContributions(slot), snapshot)
  assert.deepEqual(getSlotContributions(slot).map((c) => c.id), ['plugin-b', 'plugin-a', 'plugin-c'])
})

test('registerSlot without options keeps the one-per-slot replace behaviour', () => {
  const First = () => null
  const Second = () => null
  const Other = () => null
  const slot = 'test:default'
  const warnings: unknown[][] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => void warnings.push(args)
  try {
    registerSlot(slot, First)
    assert.equal(getSlot(slot), First)
    registerSlot(slot, Second)
    assert.equal(getSlot(slot), Second, 'the second default replaces the first')
    assert.deepEqual(getSlotContributions(slot).map((c) => [c.id, c.order]), [[DEFAULT_SLOT_ID, 100]])
    assert.equal(warnings.length, 1)
    assert.match(String(warnings[0][0]), /registerSlot\('test:default'\) replaces an earlier registration/)

    // A named contribution sits next to the default one; it does not replace it.
    registerSlot(slot, Other, { id: 'other', order: 50 })
    assert.deepEqual(getSlotContributions(slot).map((c) => c.id), ['other', DEFAULT_SLOT_ID])
    assert.equal(warnings.length, 1)

    // Replacing a named contribution keeps its place among equal orders.
    registerSlot(slot, First, { id: 'x' })
    registerSlot(slot, Other, { id: 'y' })
    registerSlot(slot, Second, { id: 'x' })
    assert.deepEqual(
      getSlotContributions(slot).map((c) => c.id),
      ['other', DEFAULT_SLOT_ID, 'x', 'y'],
    )
    assert.equal(warnings.length, 2)
    assert.match(String(warnings[1][0]), /\{ id: 'x' \}/)
  } finally {
    console.warn = original
  }
})

test('registerSlot validates its options', () => {
  const C = () => null
  assert.throws(() => registerSlot('test:bad', C, { id: '' }), TypeError)
  assert.throws(() => registerSlot('test:bad', C, { id: 5 as unknown as string }), TypeError)
  assert.throws(() => registerSlot('test:bad', C, { order: Number.NaN }), TypeError)
  assert.throws(() => registerSlot('test:bad', C, { order: '1' as unknown as number }), TypeError)
  assert.throws(() => registerSlot('test:bad', C, null as unknown as object), TypeError)
  assert.deepEqual(getSlotContributions('test:bad'), [])
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
