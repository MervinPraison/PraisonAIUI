// Contract tests for sdk/layouts.ts and the manifest's `layouts` (ADR 0003).
// Node, no DOM: `window` is globalThis and React renders to strings.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, Suspense } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prerenderToNodeStream } from 'react-dom/static'
import {
  activateLayout,
  getActiveLayout,
  getLayoutComponent,
  getLayoutData,
  getLayouts,
  layoutViewport,
  LAYOUT_PREVIEW_KEY,
  LAYOUT_STORAGE_KEY,
  loadLayoutData,
  parseLayoutChoice,
  provideLayoutData,
  provideLayoutHost,
  readStoredLayout,
  registerLayout,
  resetLayoutsForTests,
  setLayout,
  subscribeLayouts,
  useLayout,
  useLayoutData,
  type LayoutComponent,
  type LayoutMeta,
  type LayoutProps,
} from '@/sdk/layouts'
import type { ApprovalsFeed, LayoutDataMap, SessionsFeed } from '@/sdk/layoutTypes'
import { CLASSIC_LAYOUT_ID, normalizeManifest } from '@/sdk/manifest'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis

class MemoryStorage {
  data = new Map<string, string>()
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v))
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
}

let local: MemoryStorage
let session: MemoryStorage

function setStorage(name: 'localStorage' | 'sessionStorage', value: unknown) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}

function quietly<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = []
  const original = console.warn
  console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '))
  try {
    return { result: fn(), warnings }
  } finally {
    console.warn = original
  }
}

beforeEach(() => {
  resetLayoutsForTests()
  local = new MemoryStorage()
  session = new MemoryStorage()
  setStorage('localStorage', local)
  setStorage('sessionStorage', session)
})

const meta: LayoutMeta = { title: 'Focus' }
const Frame: LayoutComponent = function Frame({ pageId }: LayoutProps) {
  return createElement('main', null, `frame ${pageId}`)
}

async function prerender(node: ReturnType<typeof createElement>): Promise<string> {
  const { prelude } = await prerenderToNodeStream(node)
  let html = ''
  for await (const chunk of prelude) html += String(chunk)
  return html
}

// ── registration ─────────────────────────────────────────────────────

test('registerLayout lists the layout and hands its component to the host; the remover removes it', () => {
  let changes = 0
  const off = subscribeLayouts(() => (changes += 1))
  const remove = registerLayout('focus', meta, Frame)
  assert.equal(changes, 1)
  assert.deepEqual(getLayouts(), [{ id: 'focus', meta: { title: 'Focus' } }])
  assert.ok(Object.isFrozen(getLayouts()) && Object.isFrozen(getLayouts()[0].meta))
  assert.equal(getLayouts(), getLayouts(), 'snapshot identity is stable without changes')
  assert.equal(getLayoutComponent('focus'), Frame)
  remove()
  assert.deepEqual(getLayouts(), [])
  assert.equal(getLayoutComponent('focus'), undefined)
  remove() // twice: nothing to do
  assert.equal(changes, 2)
  off()
})

test('a loader is not called at registration, only when the frame first renders', async () => {
  let calls = 0
  registerLayout('lazy-one', meta, () => {
    calls += 1
    return Promise.resolve({ default: Frame })
  })
  assert.equal(calls, 0, 'registering downloads nothing')
  const C = getLayoutComponent('lazy-one')!
  assert.notEqual(C, Frame)
  assert.equal(calls, 0)
  const props = { pageId: 'home' } as LayoutProps
  const html = await prerender(createElement(Suspense, { fallback: 'skeleton' }, createElement(C, props)))
  assert.match(html, /frame home/)
  assert.equal(calls, 1)
})

test('registering an id again replaces it with a warning; the old remover leaves the new one', () => {
  const removeFirst = registerLayout('dup', meta, Frame)
  const Other: LayoutComponent = function Other() {
    return null
  }
  const { warnings } = quietly(() => registerLayout('dup', { title: 'Second' }, Other))
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /registerLayout\('dup'\) replaces an earlier registration/)
  removeFirst()
  assert.equal(getLayoutComponent('dup'), Other)
  assert.equal(getLayouts()[0].meta.title, 'Second')
})

test('registerLayout rejects bad ids, the reserved classic id, bad meta and non-components', () => {
  for (const id of ['', 'Focus', '1st', 'has space', 'x'.repeat(41), CLASSIC_LAYOUT_ID]) {
    assert.throws(() => registerLayout(id, meta, Frame), TypeError, id)
  }
  assert.throws(() => registerLayout('ok', null as unknown as LayoutMeta, Frame), TypeError)
  assert.throws(() => registerLayout('ok', { title: '' }, Frame), TypeError)
  assert.throws(() => registerLayout('ok', { title: 'T', chat: { aside: 'Panel' as never } }, Frame), TypeError)
  assert.throws(() => registerLayout('ok', meta, 42 as unknown as LayoutComponent), TypeError)
  assert.deepEqual(getLayouts(), [])
})

test('unknown presentation values (from a newer SDK) are dropped with a warning, the rest kept', () => {
  const aside = () => Promise.resolve({ default: () => null })
  const raw = {
    title: 'T',
    approvals: 'banner',
    chat: { sessions: 'frame', thread: 'cards', approvals: 'card', aside, asideLabel: 'Canvas' },
    later: 1,
  } as unknown as LayoutMeta
  const { warnings } = quietly(() => registerLayout('newer', raw, Frame))
  assert.equal(warnings.length, 2)
  const got = getLayouts()[0].meta
  assert.equal(got.approvals, undefined)
  assert.deepEqual(got.chat, { sessions: 'frame', approvals: 'card', aside, asideLabel: 'Canvas' })
  assert.equal((got as unknown as { later: number }).later, 1, 'unknown keys pass through')
  assert.ok(Object.isFrozen(got.chat))
})

// ── active layout ────────────────────────────────────────────────────

function Probe() {
  const l = useLayout()
  return createElement('i', null, l ? `${l.id}:${l.meta.chat?.sessions ?? 'page'}` : 'classic')
}

test('useLayout is null for the classic frame and for a layout not registered yet', () => {
  assert.equal(renderToStaticMarkup(createElement(Probe)), '<i>classic</i>')
  activateLayout('later')
  assert.equal(getActiveLayout(), null, 'not registered yet')
  registerLayout('later', { title: 'Later', chat: { sessions: 'tabs' } }, Frame)
  assert.equal(renderToStaticMarkup(createElement(Probe)), '<i>later:tabs</i>')
  assert.equal(getActiveLayout(), getActiveLayout(), 'stable snapshot')
  activateLayout('')
  assert.equal(renderToStaticMarkup(createElement(Probe)), '<i>classic</i>')
  activateLayout('Not An Id')
  assert.equal(getActiveLayout(), null)
})

test('setLayout remembers the choice, clears a preview, and activates through the default host', () => {
  registerLayout('focus', meta, Frame)
  session.setItem(LAYOUT_PREVIEW_KEY, 'other')
  setLayout('focus')
  assert.equal(local.getItem(LAYOUT_STORAGE_KEY), 'focus')
  assert.equal(session.getItem(LAYOUT_PREVIEW_KEY), null)
  assert.equal(getActiveLayout()?.id, 'focus')
  assert.deepEqual(readStoredLayout(), { preview: null, choice: 'focus' })

  setLayout('', { persist: false })
  assert.equal(session.getItem(LAYOUT_PREVIEW_KEY), CLASSIC_LAYOUT_ID)
  assert.equal(local.getItem(LAYOUT_STORAGE_KEY), 'focus', 'a tab-only switch keeps the choice')
  assert.deepEqual(readStoredLayout(), { preview: '', choice: 'focus' })
  assert.equal(getActiveLayout(), null)

  assert.throws(() => setLayout('Bad Id'), TypeError)
})

test('the shell can take over the switch with provideLayoutHost', () => {
  const calls: [string, boolean][] = []
  provideLayoutHost({ select: (id, { persist }) => void calls.push([id, persist]) })
  setLayout(CLASSIC_LAYOUT_ID)
  setLayout('focus', { persist: false })
  assert.deepEqual(calls, [['', true], ['focus', false]])
  assert.equal(getActiveLayout(), null, 'the shell decides what becomes active')
})

test('stored values are parsed; blocked storage is ignored', () => {
  assert.equal(parseLayoutChoice('classic'), '')
  assert.equal(parseLayoutChoice(''), '')
  assert.equal(parseLayoutChoice('focus'), 'focus')
  assert.equal(parseLayoutChoice('<script>'), null)
  assert.equal(parseLayoutChoice(null), null)
  local.setItem(LAYOUT_STORAGE_KEY, 'garbage!')
  assert.deepEqual(readStoredLayout(), { preview: null, choice: null })

  const blocked = {
    getItem() {
      throw new Error('SecurityError')
    },
    setItem() {
      throw new Error('SecurityError')
    },
    removeItem() {
      throw new Error('SecurityError')
    },
  }
  setStorage('localStorage', blocked)
  setStorage('sessionStorage', blocked)
  assert.deepEqual(readStoredLayout(), { preview: null, choice: null })
  registerLayout('focus', meta, Frame)
  setLayout('focus')
  assert.equal(getActiveLayout()?.id, 'focus', 'the switch still happens')
})

test('layoutViewport uses the shell breakpoints', () => {
  assert.equal(layoutViewport(390), 'phone')
  assert.equal(layoutViewport(767), 'phone')
  assert.equal(layoutViewport(768), 'tablet')
  assert.equal(layoutViewport(1023), 'tablet')
  assert.equal(layoutViewport(1440), 'desktop')
})

// ── data feeds ───────────────────────────────────────────────────────

function feed<S>(state: S) {
  return { get: () => state, subscribe: () => () => {} }
}

const approvals: ApprovalsFeed = {
  ...feed({ pending: [{ id: 'a1', toolName: 'shell' }] }),
  approve: async () => {},
  deny: async () => {},
}

function DataProbe({ kind }: { kind: keyof LayoutDataMap }) {
  const f = useLayoutData(kind)
  return createElement('b', null, f ? 'on' : 'off')
}

test('useLayoutData is null without a provider and returns a provided feed', () => {
  assert.equal(renderToStaticMarkup(createElement(DataProbe, { kind: 'approvals' })), '<b>off</b>')
  const remove = provideLayoutData('approvals', approvals)
  assert.equal(getLayoutData('approvals'), approvals)
  assert.equal(renderToStaticMarkup(createElement(DataProbe, { kind: 'approvals' })), '<b>on</b>')
  remove()
  assert.equal(getLayoutData('approvals'), null)
  assert.equal(renderToStaticMarkup(createElement(DataProbe, { kind: 'approvals' })), '<b>off</b>')
})

test('a lazy provider loads only when a frame first reads the kind, once', async () => {
  let calls = 0
  const sessions = { ...feed({ sessions: [], activeId: null, runningIds: new Set<string>(), loading: false }) } as unknown as SessionsFeed
  provideLayoutData('sessions', () => {
    calls += 1
    return Promise.resolve(sessions)
  })
  await Promise.resolve()
  assert.equal(calls, 0, 'providing loads nothing')
  assert.equal(getLayoutData('sessions'), null, 'getLayoutData never starts a load')

  const html = renderToStaticMarkup(createElement(DataProbe, { kind: 'sessions' }))
  assert.equal(html, '<b>off</b>', 'null while loading')
  renderToStaticMarkup(createElement(DataProbe, { kind: 'sessions' }))
  assert.equal(await loadLayoutData('sessions'), sessions)
  assert.equal(calls, 1, 'one load for every reader')
  assert.equal(renderToStaticMarkup(createElement(DataProbe, { kind: 'sessions' })), '<b>on</b>')
})

test('a failed or replaced lazy provider yields null, and providing again retries', async () => {
  const errors: unknown[] = []
  const original = console.error
  console.error = (...args: unknown[]) => void errors.push(args)
  try {
    provideLayoutData('approvals', () => Promise.reject(new Error('chunk failed')))
    assert.equal(await loadLayoutData('approvals'), null)
    assert.equal(errors.length, 1)
    assert.equal(await loadLayoutData('approvals'), null, 'no retry loop')
    assert.equal(errors.length, 1)

    quietly(() => provideLayoutData('approvals', () => Promise.resolve(42 as unknown as ApprovalsFeed)))
    assert.equal(await loadLayoutData('approvals'), null, 'a non-object is not a feed')

    let resolveSlow!: (f: ApprovalsFeed) => void
    quietly(() => provideLayoutData('approvals', () => new Promise<ApprovalsFeed>((r) => (resolveSlow = r))))
    const pending = loadLayoutData('approvals')
    await Promise.resolve()
    quietly(() => provideLayoutData('approvals', approvals))
    resolveSlow({ ...approvals })
    assert.equal(await pending, null, 'a replaced loader does not win')
    assert.equal(getLayoutData('approvals'), approvals)
  } finally {
    console.error = original
  }
})

test('provideLayoutData validates its arguments', () => {
  assert.throws(() => provideLayoutData('' as 'chat', approvals as never), TypeError)
  assert.throws(() => provideLayoutData('chat', null as never), TypeError)
  assert.throws(() => provideLayoutData('chat', 'feed' as never), TypeError)
})

// ── manifest ─────────────────────────────────────────────────────────

test('normalizeManifest passes `layouts` through and leaves it out for older servers', () => {
  const base = { pages: [] }
  assert.equal(normalizeManifest(base)!.layouts, undefined)
  assert.ok(!('layouts' in normalizeManifest(base)!), 'absent key means classic')

  const m = normalizeManifest({
    ...base,
    layouts: {
      default: 'focus',
      userChoice: false,
      available: [
        { id: 'focus', title: 'Focus', source: 'builtin', home: 'start', primary: ['a', 'b'], options: { x: 1 }, order: 2 },
        { id: 'focus', title: 'Duplicate', source: 'builtin' },
        { id: 'plug', source: 'plugin:demo', module: '/_plugins/demo/frame.js', primary: [1] },
        { id: CLASSIC_LAYOUT_ID, title: 'Classic', source: 'builtin' },
        { id: 'Bad Id', title: 'x', source: 'builtin' },
        'nope',
      ],
    },
  })!
  assert.deepEqual(m.layouts, {
    default: 'focus',
    userChoice: false,
    available: [
      { id: 'focus', title: 'Focus', source: 'builtin', home: 'start', primary: ['a', 'b'], options: { x: 1 }, order: 2 },
      { id: 'plug', title: 'plug', source: 'plugin:demo', module: '/_plugins/demo/frame.js' },
    ],
  })

  const loose = normalizeManifest({ ...base, layouts: { default: CLASSIC_LAYOUT_ID } })!
  assert.deepEqual(loose.layouts, { default: '', userChoice: true, available: [] })
  assert.equal(normalizeManifest({ ...base, layouts: 'focus' })!.layouts, undefined)
})

test('normalizeManifest keeps page layout fields and drops ill-typed ones', () => {
  const good = { id: 'p', title: 'P', kind: 'native', layouts: ['focus'], replaces: 'q', pageType: 'board' }
  const bad = { id: 'r', title: 'R', kind: 'native', layouts: 'focus', replaces: 3, pageType: {} }
  const m = normalizeManifest({ pages: [good, bad] })!
  assert.equal(m.pages[0], good, 'a valid page is passed through as is')
  assert.deepEqual(m.pages[1], { id: 'r', title: 'R', kind: 'native' })
})
