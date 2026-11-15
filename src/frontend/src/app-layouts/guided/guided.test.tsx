// Guided Studio (ADR 0003 §4 G): nav mapping, templates, follow-up chips,
// the frame on desktop and phone, and the descriptor with its pages.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { provideLayoutData, resetLayoutsForTests, type LayoutNav, type LayoutNavItem, type LayoutProps, type LayoutViewport } from '@/sdk/layouts'
import type { ChatFeed, ChatMessageView, SessionsFeed, SessionsState } from '@/sdk/layoutTypes'
import { guidedLayout, guidedPagesBuiltin } from '@/builtin/layouts/guided'
import GuidedFrame from './Frame'
import FollowUps from './FollowUps'
import { guidedNav, helpAddress, whenLabel } from './nav'
import { agentOf, followUpsFor } from './chat'
import { DEFAULT_TEMPLATES, filterTemplates, groupByCategory, normalizeStarters, OTHER_CATEGORY } from './templates'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis

beforeEach(() => resetLayoutsForTests())

const item = (id: string, title: string, extra: Partial<LayoutNavItem> = {}): LayoutNavItem => ({
  id,
  title,
  group: 'Agent',
  href: `/${id}`,
  active: false,
  ...extra,
})

function layoutNav(activeId = 'chat'): LayoutNav {
  const mark = (i: LayoutNavItem) => ({ ...i, active: i.id === activeId })
  return {
    primary: [item('start', 'Start'), item('chat', 'Chat'), item('agents', 'Agents'), item('templates', 'Templates')].map(mark),
    groups: [
      { name: 'Control', folded: false, items: [item('logs', 'Logs', { group: 'Control' }), item('sessions', 'Sessions', { group: 'Control' })].map(mark) },
      { name: 'Settings', folded: true, items: [item('config', 'Config', { group: 'Settings' })].map(mark) },
    ],
    footer: [item('auth', 'Sign out')],
    activeId,
    go: () => {},
  }
}

test('guidedNav: plain titles, Help after the primary pages, Settings on its own, the rest under More tools', () => {
  const n = guidedNav(layoutNav())
  assert.deepEqual(n.main.map((i) => i.title), ['Home', 'Chat', 'My agents', 'Templates', 'Help'])
  assert.equal(n.main.find((i) => i.id === 'chat')?.active, true)
  assert.equal(n.main.at(-1)?.external, undefined, 'without a help address, Help opens the palette')
  assert.deepEqual(n.settings && [n.settings.id, n.settings.title], ['config', 'Settings'])
  assert.deepEqual(n.more.map((g) => [g.name, g.items.map((i) => i.id)]), [['Control', ['logs', 'sessions']], ['Other', ['auth']]])
  assert.deepEqual(n.tabs.map((t) => t.title), ['Home', 'Chat', 'My agents', 'Help'])
  assert.ok(n.main.length <= 7)
  assert.equal(n.byId.get('agents')?.title, 'My agents', 'the header names a page the way the nav does')
})

test('guidedNav: pages the server does not list are left out; Help takes the configured address', () => {
  const nav = layoutNav()
  const without: LayoutNav = { ...nav, primary: nav.primary.filter((i) => i.id !== 'start' && i.id !== 'templates'), groups: [] }
  const n = guidedNav(without, { helpUrl: 'https://docs.example.com/help' })
  assert.deepEqual(n.main.map((i) => i.id), ['chat', 'agents', 'help'])
  assert.equal(n.main.at(-1)?.external, 'https://docs.example.com/help')
  assert.equal(n.settings, null)
  assert.deepEqual(n.tabs.map((t) => t.id), ['chat', 'agents', 'help'])
  assert.equal(helpAddress('https://x.test/a'), 'https://x.test/a')
  assert.equal(helpAddress('/docs'), '/docs')
  assert.equal(helpAddress('//evil.test'), undefined)
  assert.equal(helpAddress('javascript:alert(1)'), undefined)
  assert.equal(helpAddress(42), undefined)
})

test('whenLabel: today with the time, yesterday, then the date', () => {
  const now = new Date(2026, 10, 15, 16, 0).getTime()
  assert.equal(whenLabel(new Date(2026, 10, 15, 14, 14).getTime(), now, 'en-US'), 'Today, 2:14 pm')
  assert.equal(whenLabel(new Date(2026, 10, 14, 9, 0).getTime(), now, 'en-US'), 'Yesterday')
  assert.equal(whenLabel(new Date(2026, 10, 10, 9, 0).getTime(), now, 'en-GB'), 'Tue 10 Nov')
  assert.equal(whenLabel(undefined, now), '')
})

test('templates: the app’s starters with category, description and icon; defaults otherwise', () => {
  const list = normalizeStarters({
    starters: [
      { label: 'Weekly metrics', message: 'Show this week’s metrics', category: 'Analyse', icon: '📊', description: 'Charts of the week' },
      { message: 'Summarise the release notes' },
      { label: 'No prompt' },
      'junk',
      { prompt: 'Plan my day', icon: 'calendar-days' },
    ],
  })
  assert.deepEqual(
    list.map((t) => [t.title, t.category, t.icon, t.description]),
    [
      ['Weekly metrics', 'Analyse', '📊', 'Charts of the week'],
      ['Summarise the release notes', OTHER_CATEGORY, undefined, undefined],
      ['Plan my day', OTHER_CATEGORY, undefined, undefined],
    ],
  )
  assert.deepEqual(normalizeStarters(null), [])
  assert.deepEqual(normalizeStarters([{ message: 'hi' }]).map((t) => t.prompt), ['hi'])
  assert.deepEqual(groupByCategory(DEFAULT_TEMPLATES).map((g) => g.name), ['Write', 'Learn', 'Plan', 'Code', 'Analyse'])
  assert.deepEqual(filterTemplates(DEFAULT_TEMPLATES, 'plan steps').map((t) => t.id), ['d-plan'])
  assert.deepEqual(filterTemplates(DEFAULT_TEMPLATES, '', 'Code').map((t) => t.id), ['d-code'])
  assert.equal(filterTemplates(DEFAULT_TEMPLATES, 'zzz').length, 0)
})

const turn = (id: string, over: Partial<ChatMessageView> = {}): ChatMessageView => ({
  id,
  role: 'assistant',
  createdAt: 0,
  status: { type: 'complete' },
  parts: [{ type: 'text', id: `t-${id}`, text: 'ok' }],
  ...over,
})

function chatFeed(messages: ChatMessageView[], isRunning = false): ChatFeed & { prefilled: string[] } {
  const prefilled: string[] = []
  const state = { sessionId: 's1', messages, isRunning }
  return {
    prefilled,
    get: () => state,
    subscribe: () => () => {},
    prefill: (t) => void prefilled.push(t),
    cancel: async () => {},
    resolveApproval: async () => {},
  }
}

test('follow-ups: only under the latest finished answer, only when the server suggested some', () => {
  const chips = ['Show a mergesort example', 'Explain Big-O in plain words', ' ', 'Time all three on my data']
  const msgs = [
    turn('a1', { custom: { suggestions: ['old'] } }),
    { id: 'u2', role: 'user', createdAt: 0, parts: [{ type: 'text', id: 'x', text: 'q' }] } as ChatMessageView,
    turn('a2', { custom: { suggestions: chips } }),
  ]
  assert.deepEqual(followUpsFor(msgs, 'a2'), ['Show a mergesort example', 'Explain Big-O in plain words', 'Time all three on my data'])
  assert.deepEqual(followUpsFor(msgs, 'a1'), [], 'an older turn offers none')
  assert.deepEqual(followUpsFor([turn('r', { status: { type: 'running' }, custom: { suggestions: chips } })], 'r'), [])
  assert.deepEqual(followUpsFor([turn('n')], 'n'), [])
  assert.deepEqual(followUpsFor([turn('bad', { custom: { suggestions: 'nope' } })], 'bad'), [])

  const render = (viewport: LayoutViewport) =>
    renderToStaticMarkup(createElement(FollowUps, { messageId: 'a2', sessionId: 's1', viewport, reportBadge: () => {} }))
  assert.equal(render('desktop'), '', 'nothing without the chat feed')
  provideLayoutData('chat', chatFeed(msgs))
  const out = render('desktop')
  assert.match(out, /aria-label="You could ask next"/)
  assert.match(out, />Show a mergesort example</)
  assert.match(out, /min-h-11/, "44 px chips")
  assert.match(render('phone'), /min-h-11/, '44 px chips on a phone too')
})

test('agentOf: the last reply’s agent, else the session’s', () => {
  const state = { sessionId: 's', isRunning: false, messages: [turn('a', { agentName: 'Writer' }), turn('b', { agentName: 'Researcher' })] }
  assert.equal(agentOf(state), 'Researcher')
  assert.equal(agentOf({ ...state, messages: [] }, { id: 's', title: 'x', agent: 'Analyst' }), 'Analyst')
  assert.equal(agentOf({ ...state, messages: [] }), null)
})

function sessionsFeed(state: Partial<SessionsState>): SessionsFeed {
  const full: SessionsState = { sessions: [], activeId: null, runningIds: new Set(), loading: false, ...state }
  return { get: () => full, subscribe: () => () => {}, select: () => {}, create: () => {}, rename: async () => {}, remove: async () => {}, refresh: async () => {} }
}

const Outlet: ComponentType<{ className?: string }> = () => createElement('div', { 'data-outlet': '' })
const Slot: ComponentType<{ name: string; className?: string }> = ({ name }) => createElement('span', { 'data-slot-name': name })

function frameProps(viewport: LayoutViewport, pageId = 'chat'): LayoutProps {
  return {
    Outlet,
    pageId,
    page: { id: pageId, title: pageId === 'chat' ? 'Chat' : 'Logs', kind: 'native' },
    fullBleed: pageId === 'chat',
    nav: layoutNav(pageId),
    chrome: { siteTitle: 'PraisonAI', siteLogo: null, openPalette: () => {}, toggleColorMode: () => {}, Slot, mainId: 'aiui-main' },
    viewport,
    layout: { id: 'guided', available: [{ id: 'guided', title: 'Guided Studio', source: 'builtin.layout-guided', home: 'start' }], switchTo: () => {} },
  }
}

function withChat() {
  provideLayoutData(
    'sessions',
    sessionsFeed({
      sessions: [
        { id: 's1', title: 'Compare sorting algorithms', agent: 'Researcher' },
        { id: 's2', title: 'Quick: summarise release notes', agent: 'Writer' },
        { id: 's3', title: 'Three' },
        { id: 's4', title: 'Four' },
        { id: 's5', title: 'Five' },
        { id: 's6', title: 'Six' },
      ],
      activeId: 's1',
    }),
  )
  provideLayoutData('chat', chatFeed([turn('a1', { agentName: 'Researcher' })]))
}

test('desktop frame: sidebar destinations, recent chats as cards, the chat header, the main landmark', () => {
  withChat()
  const out = renderToStaticMarkup(createElement(GuidedFrame, frameProps('desktop')))
  assert.match(out, /data-aiui-layout-frame="guided" data-viewport="desktop"/)
  assert.match(out, /<nav aria-label="Main"/)
  assert.match(out, />Start a new chat</)
  for (const t of ['Home', 'My agents', 'Templates', 'Help', 'Settings']) assert.match(out, new RegExp(`>${t}</`), t)
  assert.match(out, /aria-current="page" data-aiui-nav-item="chat"/)
  assert.match(out, />Your recent chats</)
  assert.equal((out.match(/data-aiui-session="/g) ?? []).length, 5, 'five recent chats')
  assert.match(out, />See all</)
  assert.match(out, /<h1[^>]*>Compare sorting algorithms<\/h1>/)
  assert.match(out, /Chatting with Researcher · ready to help/)
  assert.match(out, />Change agent</)
  assert.match(out, /<main[^>]*id="aiui-main"/)
  assert.match(out, /data-outlet=""/)
  assert.match(out, />More tools</)
  assert.match(out, /data-slot-name="header:actions"/)
  assert.doesNotMatch(out, /data-aiui-phone-tabs/)
})

test('desktop frame on another page: its title, no Change agent; works with no chat feeds', () => {
  const out = renderToStaticMarkup(createElement(GuidedFrame, frameProps('desktop', 'logs')))
  assert.match(out, /<h1[^>]*>Logs<\/h1>/)
  assert.doesNotMatch(out, /Change agent/)
  assert.doesNotMatch(out, /Start a new chat/, 'no New chat without the sessions feed')
  assert.doesNotMatch(out, /Your recent chats/)
})

test('phone frame: 60 px header with the chat and new chat, four bottom tabs, 44 px targets', () => {
  withChat()
  const out = renderToStaticMarkup(createElement(GuidedFrame, frameProps('phone')))
  assert.match(out, /data-viewport="phone"/)
  assert.match(out, /h-15 /, "a 60 px header")
  assert.match(out, /aria-label="Your chats and more"[^>]*aria-haspopup="dialog"/)
  assert.match(out, /aria-label="Start a new chat"/)
  assert.match(out, />with Researcher</)
  assert.match(out, /data-aiui-phone-tabs=""/)
  const tabs = [...out.matchAll(/data-aiui-tab="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(tabs, ['start', 'chat', 'agents', 'help'])
  assert.match(out, /aria-current="page" data-aiui-tab="chat"/)
  resetLayoutsForTests()
  provideLayoutData('chat', chatFeed([turn('g', { agentName: 'Researcher', status: { type: 'requires-action', reason: 'interrupt' } })]))
  assert.match(renderToStaticMarkup(createElement(GuidedFrame, frameProps('desktop'))), /Chatting with Researcher · waiting for your OK/)
  assert.doesNotMatch(out, /w-\[280px\]/, 'no sidebar on a phone')
  assert.match(out, /size-11/)
})

test('descriptor: the Guided chat presentation, with each region a lazy loader', () => {
  const chat = guidedLayout.meta.chat!
  assert.equal(guidedLayout.id, 'guided')
  assert.equal(chat.sessions, 'frame')
  assert.equal(chat.thread, 'steps')
  assert.equal(chat.approvals, 'card')
  for (const r of [chat.turnHeader, chat.turnFooter, chat.empty]) {
    assert.equal(typeof r, 'function')
    assert.equal(r!.length, 0)
  }
  assert.equal(guidedLayout.meta.approvals, undefined, 'toasts stay on for other chats (the chat page shows its own gate)')
})

test('guidedPagesBuiltin registers only the pages the manifest lists, lazily', () => {
  const registered: [string, unknown][] = []
  const sdk = { registerPage: (id: string, c: unknown) => void registered.push([id, c]) } as unknown as Parameters<typeof guidedPagesBuiltin.activate>[0]
  assert.equal(guidedPagesBuiltin.name, 'builtin.layout-guided')
  assert.deepEqual([...guidedPagesBuiltin.pages], ['start', 'templates'])
  guidedPagesBuiltin.activate(sdk, { manifest: {} as never, pageIds: ['start'] })
  assert.deepEqual(registered.map(([id]) => id), ['start'])
  assert.equal(typeof registered[0][1], 'function')
  assert.equal((registered[0][1] as () => unknown).length, 0, 'a loader, not a component')
})
