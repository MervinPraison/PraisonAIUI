// Shell navigation, icon-map and approval-toast helpers (WP6).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import {
  defaultPageId,
  footerPages,
  groupPages,
  isFullBleed,
  isGroupOpen,
  needsLegacyRuntime,
  orderedPages,
  readGroupState,
  revealInScroller,
  showPageHeader,
  showSidebar,
  siteLogo,
  siteTitle,
  usesLegacyHost,
  writeGroupState,
} from '@/shell/nav'
import { emojiForPage, FallbackPageIcon, ICON_BY_PAGE_ID, iconForPage, PAGE_ICON_SET } from '@/shell/icons'
import { approvalKey, describeApproval } from '@/builtin/approvals'
import { isPaletteShortcut, isSidebarShortcut } from '@/shell/palette'

const p = (id: string, group: string | undefined, order: number, extra: Partial<ShellPage> = {}): ShellPage => ({
  id,
  title: id[0].toUpperCase() + id.slice(1),
  kind: 'legacy',
  group,
  order,
  ...extra,
})

// A slice of the built-in pages, in the server's (order, id) manifest order.
const PAGES: ShellPage[] = [
  p('chat', 'Agent', 1),
  p('chat-canvas', 'Agent', 2),
  p('work', 'Work', 9),
  p('agents', 'Agent', 10),
  p('config', 'Settings', 10),
  p('overview', 'Control', 10),
  p('hello', 'Plugins', 50, { kind: 'react', module: '/_plugins/hello/hello.js' }),
  p('logs', 'Settings', 20),
  p('inspector', 'Control', 99, { position: 'footer' } as Partial<ShellPage>),
  p('misc', undefined, 100),
]

const manifest = (over: Partial<ShellManifest> = {}): ShellManifest => ({
  sdk: 1,
  version: '0.0.0',
  style: 'app',
  site: { title: 'Acme AI' },
  layout: {},
  pages: PAGES,
  blocks: [],
  toolRenderers: [],
  plugins: [],
  legacy: { customJs: null, viewsBase: '/plugins/views/' },
  ...over,
})

test('groups follow Agent, Work, Control, then other groups, with Settings last', () => {
  const groups = groupPages(PAGES)
  assert.deepEqual(
    groups.map((g) => g.name),
    ['Agent', 'Work', 'Control', 'Plugins', 'Other', 'Settings'],
  )
  assert.deepEqual(
    groups[0].pages.map((x) => x.id),
    ['chat', 'chat-canvas', 'agents'],
  )
  assert.deepEqual(
    groups.find((g) => g.name === 'Settings')?.pages.map((x) => x.id),
    ['config', 'logs'],
  )
})

test('footer pages are listed separately and last in display order', () => {
  assert.deepEqual(footerPages(PAGES).map((x) => x.id), ['inspector'])
  assert.ok(!groupPages(PAGES).some((g) => g.pages.some((x) => x.id === 'inspector')))
  const ids = orderedPages(PAGES).map((x) => x.id)
  assert.equal(ids[0], 'chat')
  assert.equal(ids.at(-1), 'inspector')
  assert.equal(ids.length, PAGES.length)
})

test('the root redirect uses a configured default page, else the first page', () => {
  assert.equal(defaultPageId(manifest()), 'chat')
  assert.equal(defaultPageId(manifest({ layout: { default: 'overview' } as ShellManifest['layout'] })), 'overview')
  assert.equal(defaultPageId(manifest({ layout: { defaultPage: 'logs' } as ShellManifest['layout'] })), 'logs')
  assert.equal(defaultPageId(manifest({ site: { defaultPage: 'work' } })), 'work')
  assert.equal(
    defaultPageId(manifest({ layout: { default: 'missing' } as ShellManifest['layout'] })),
    'chat',
    'an unknown default falls back to the first page',
  )
  assert.equal(defaultPageId(manifest({ pages: [] })), null)
})

test('layout.sidebar / layout.pageHeader = false hide the chrome; anything else shows it', () => {
  assert.equal(showSidebar(manifest()), true)
  assert.equal(showSidebar(manifest({ layout: { sidebar: false } })), false)
  assert.equal(showSidebar(manifest({ layout: { sidebar: true } })), true)
  assert.equal(showPageHeader(manifest()), true)
  assert.equal(showPageHeader(manifest({ layout: { pageHeader: false } })), false)
  assert.equal(showPageHeader(manifest({ layout: { pageHeader: { title: true } } })), true)
})

test('full-bleed pages: layout flag, the known chat-like ids, and iframes', () => {
  assert.equal(isFullBleed(undefined, 'chat'), true)
  assert.equal(isFullBleed(p('x', 'G', 1, { layout: 'full-bleed' }), 'x'), true)
  assert.equal(isFullBleed(p('y', 'G', 1, { kind: 'iframe' }), 'y'), true)
  assert.equal(isFullBleed(p('logs', 'G', 1), 'logs'), false)
})

test('the legacy runtime is preloaded only when a page (or custom.js) needs it', () => {
  const legacy = { customJs: null, viewsBase: '/plugins/views/' }
  const react = p('hello', 'Plugins', 1, { kind: 'react', module: '/_plugins/hello/hello.js' })
  const blocks = p('board', 'Plugins', 2, { kind: 'blocks' })
  const frame = p('docs', 'Plugins', 3, { kind: 'iframe', module: '/docs/' })
  const chat = p('chat', 'Agent', 1)
  const native = p('threads', 'Agent', 2, { kind: 'native' })

  assert.equal(needsLegacyRuntime({ pages: [], legacy }), false)
  assert.equal(needsLegacyRuntime({ pages: [react, blocks, frame], legacy }), false, 'no legacy page: no dashboard.js')
  assert.equal(needsLegacyRuntime({ pages: [react, chat], legacy }), true)
  // A page a React component is registered for never reaches the legacy host.
  const registered = (id: string) => id === 'chat' || id === 'threads'
  assert.equal(needsLegacyRuntime({ pages: [react, chat, native], legacy }, registered), false)
  assert.equal(needsLegacyRuntime({ pages: [chat, native, p('logs', 'Settings', 9)], legacy }, registered), true)
  // An unregistered native page falls back to the legacy host, like PageView does.
  assert.equal(needsLegacyRuntime({ pages: [native], legacy }), true)
  // custom.js is evaluated by the legacy runtime only.
  assert.equal(needsLegacyRuntime({ pages: [react], legacy: { ...legacy, customJs: '/custom.js' } }, registered), true)

  assert.deepEqual(
    [react, blocks, frame, chat, native].map(usesLegacyHost),
    [false, false, false, true, true],
  )
})

test('site title and logo', () => {
  assert.equal(siteTitle(manifest()), 'Acme AI')
  assert.equal(siteTitle(manifest({ site: {} })), 'PraisonAI')
  assert.deepEqual(siteLogo(manifest({ site: { logo: '🦞' } })), { kind: 'text', value: '🦞' })
  assert.deepEqual(siteLogo(manifest({ site: { logo: '/static/logo.svg' } })), { kind: 'img', value: '/static/logo.svg' })
  assert.equal(siteLogo(manifest({ site: { logo: 'javascript:alert(1)' } })), null)
})

test('the static icon map stays within 34 lucide icons', () => {
  assert.ok(PAGE_ICON_SET.length <= 34, `icon budget exceeded: ${PAGE_ICON_SET.length}`)
  assert.equal(new Set(PAGE_ICON_SET).size, PAGE_ICON_SET.length)
  for (const [id, icon] of Object.entries(ICON_BY_PAGE_ID)) {
    assert.ok(PAGE_ICON_SET.includes(icon), `${id} uses an icon outside PAGE_ICON_SET`)
  }
  assert.ok(PAGE_ICON_SET.includes(FallbackPageIcon))
})

test('pages that sit together in the sidebar get distinct icons (usable collapsed rail)', () => {
  const groups = [
    ['chat', 'chat-canvas', 'channels', 'inbox', 'canvas', 'agents', 'skills', 'marketplace', 'mcp', 'memory', 'knowledge', 'cron', 'guardrails'],
    ['work', 'kanban', 'jobs-board'],
    ['overview', 'nodes', 'sessions', 'replay', 'runs', 'feedback', 'usage', 'eval', 'jobs', 'training', 'approvals', 'code-studio', 'api'],
    ['config', 'auth', 'security', 'logs', 'debug'],
  ]
  for (const ids of groups) {
    const icons = ids.map((id) => ICON_BY_PAGE_ID[id])
    const dupes = ids.filter((_, i) => icons.indexOf(icons[i]) !== i)
    assert.deepEqual(dupes, [], `repeated icons in ${ids.join(', ')}`)
  }
})

test('icons resolve by page id, then by lucide-style name, then emoji, then nothing', () => {
  assert.equal(iconForPage({ id: 'logs', icon: '📜' }), ICON_BY_PAGE_ID.logs)
  assert.equal(iconForPage({ id: 'plugin-x', icon: 'Bot' }), ICON_BY_PAGE_ID.agents)
  assert.equal(iconForPage({ id: 'plugin-y', icon: '🦄' }), undefined)
  assert.equal(emojiForPage({ icon: '🦄' }), '🦄')
  assert.equal(emojiForPage({ icon: '💬🖼️' }), '💬', 'first emoji cluster only')
  assert.equal(emojiForPage({ icon: '⚙️' }), '⚙️', 'keeps the variation selector')
  assert.equal(emojiForPage({ icon: 'rocket' }), undefined, 'unknown names never render as text')
  assert.equal(emojiForPage({}), undefined)
})

test('approval toasts: stable key and readable text', () => {
  assert.equal(approvalKey({ id: 'a1', tool_call_id: 't1' }), 'a1')
  assert.equal(approvalKey({ tool_call_id: 't1' }), 't1')
  assert.equal(approvalKey({}), '')
  assert.deepEqual(
    describeApproval({ tool_name: 'shell', agent_name: 'Coder', risk_level: 'high', description: 'rm -rf build' }),
    { title: 'Approval needed: shell', description: 'Agent Coder · high risk — rm -rf build' },
  )
  assert.deepEqual(describeApproval({}), { title: 'Approval needed', description: '' })
  assert.ok(describeApproval({ description: 'x'.repeat(500) }).description.length <= 160)
})

// A target whose closest() matches the given selectors (enough for the shortcut helpers).
const target = (...matches: string[]) =>
  ({ closest: (sel: string) => (matches.some((m) => sel.includes(m)) ? {} : null) }) as unknown as EventTarget
const key = (k: string, init: Partial<KeyboardEvent> = {}, t: EventTarget | null = target()) =>
  ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, defaultPrevented: false, target: t, ...init }) as KeyboardEvent

test('Ctrl/Cmd+K is the palette shortcut unless an editor owns it or the event was handled', () => {
  assert.equal(isPaletteShortcut(key('k', { ctrlKey: true })), true)
  assert.equal(isPaletteShortcut(key('K', { metaKey: true })), true)
  assert.equal(isPaletteShortcut(key('k')), false)
  assert.equal(isPaletteShortcut(key('k', { ctrlKey: true, shiftKey: true })), false)
  assert.equal(isPaletteShortcut(key('k', { ctrlKey: true, isComposing: true })), false)
  assert.equal(isPaletteShortcut(key('k', { ctrlKey: true }, target('.monaco-editor'))), false)
  assert.equal(isPaletteShortcut(key('k', { ctrlKey: true, defaultPrevented: true })), false)
})

test('Ctrl+K inside the open palette still toggles it, although cmdk preventDefaults it', () => {
  assert.equal(isPaletteShortcut(key('k', { ctrlKey: true, defaultPrevented: true }, target('[cmdk-root]'))), true)
})

test('Ctrl/Cmd+B toggles the sidebar, but not while typing', () => {
  assert.equal(isSidebarShortcut(key('b', { ctrlKey: true })), true)
  assert.equal(isSidebarShortcut(key('b', { ctrlKey: true }, target('input'))), false)
})

test('revealInScroller scrolls the sidebar only as far as needed, without scrollIntoView', () => {
  const scroller = (scrollTop: number) => ({ scrollTop, getBoundingClientRect: () => ({ top: 100, bottom: 500 }) })
  const item = (top: number) => ({
    getBoundingClientRect: () => ({ top, bottom: top + 32 }),
    scrollIntoView: () => assert.fail('scrollIntoView moves the focus navigation starting point'),
  })
  const visible = scroller(40)
  revealInScroller(visible, item(200))
  assert.equal(visible.scrollTop, 40)
  const below = scroller(0)
  revealInScroller(below, item(600))
  assert.equal(below.scrollTop, 600 + 32 - 500 + 8)
  const above = scroller(300)
  revealInScroller(above, item(60))
  assert.equal(above.scrollTop, 300 - (100 - 60 + 8))
})

test('sidebar groups: rarely used ones start folded, the current page\'s group is always open, the viewer\'s choice sticks', () => {
  assert.equal(isGroupOpen('Agent', false, {}), true)
  assert.equal(isGroupOpen('Examples', false, {}), false)
  assert.equal(isGroupOpen('Work', false, {}), false)
  assert.equal(isGroupOpen('Work', true, { Work: false }), true, 'the active page\'s group cannot be hidden')
  assert.equal(isGroupOpen('Agent', false, { Agent: false }), false)
  assert.equal(isGroupOpen('Examples', false, { Examples: true }), true)
  const store = new Map<string, string>()
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
  writeGroupState({ Work: true, Agent: false }, storage)
  assert.deepEqual(readGroupState(storage), { Work: true, Agent: false })
  store.set('aiui-sidebar-groups', '{"x": "yes", "y": true}')
  assert.deepEqual(readGroupState(storage), { y: true }, 'non-boolean values are ignored')
  store.set('aiui-sidebar-groups', 'not json')
  assert.deepEqual(readGroupState(storage), {})
})
