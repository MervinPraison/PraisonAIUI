// The Quiet Workbench frame (Track W): its view model (title, agent, model,
// waiting sessions, home page), its shortcuts and the rendered frame on a
// desktop and a phone, with and without the chat and approvals feeds.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { provideLayoutData, resetLayoutsForTests, type LayoutNavItem, type LayoutProps, type LayoutViewport } from '@/sdk/layouts'
import type { ApprovalsFeed, ChatFeed, ChatState, SessionsFeed, SessionsState } from '@/sdk/layoutTypes'
import { matchesShortcut } from '@/app-layouts/kit'
import { workbenchLayout } from '@/builtin/layouts/workbench'
import WorkbenchFrame from './Frame'
import { agentOf, chatPageOf, frameTitle, modelsByAgent, SHORTCUTS, waitingSessionIds } from './model'

beforeEach(() => resetLayoutsForTests())

const SESSIONS: SessionsState = {
  sessions: [
    { id: 'sort', title: 'Compare sorting algorithms', agent: 'Researcher', updatedAt: Date.now() - 5_000 },
    { id: 'notes', title: 'Quick: summarise release notes', updatedAt: Date.now() - 2 * 3_600_000 },
  ],
  activeId: 'sort',
  runningIds: new Set(),
  loading: false,
}

const feed = <S,>(state: S) => ({ get: () => state, subscribe: () => () => {} })

function sessionsFeed(state: SessionsState = SESSIONS): SessionsFeed {
  return { ...feed(state), select() {}, create() {}, rename: async () => {}, remove: async () => {}, refresh: async () => {} }
}

function chatFeed(state: Partial<ChatState> = {}): ChatFeed {
  return { ...feed({ sessionId: 'sort', messages: [], isRunning: false, ...state }), prefill() {}, cancel: async () => {}, resolveApproval: async () => {} }
}

function approvalsFeed(sessionIds: string[]): ApprovalsFeed {
  return { ...feed({ pending: sessionIds.map((sid, i) => ({ id: `ap${i}`, sessionId: sid, toolName: 'shell' })) }), approve: async () => {}, deny: async () => {} }
}

const navItem = (id: string, title: string, extra: Partial<LayoutNavItem> = {}): LayoutNavItem => ({
  id,
  title,
  group: 'Main',
  href: `/${id}`,
  active: false,
  ...extra,
})

function props(pageId: string, viewport: LayoutViewport = 'desktop', pageTitle = 'Chat'): LayoutProps {
  const primary = [
    navItem('chat', 'Chat', { navIcon: 'message-square', active: pageId === 'chat' }),
    navItem('agents', 'Agents', { navIcon: 'bot' }),
    navItem('knowledge', 'Knowledge', { navIcon: 'book-open' }),
    navItem('runs', 'Runs', { navIcon: 'activity' }),
    navItem('config', 'Config', { navIcon: 'settings' }),
  ]
  const Outlet: ComponentType<{ className?: string }> = () => createElement('div', { 'data-outlet': pageId })
  const Slot: ComponentType<{ name: string; className?: string }> = ({ name }) => createElement('span', { 'data-slot-name': name })
  return {
    Outlet,
    pageId,
    page: { id: pageId, title: pageTitle } as LayoutProps['page'],
    fullBleed: pageId === 'chat',
    nav: {
      primary,
      groups: [{ name: 'Control', folded: false, items: [navItem('logs', 'Logs', { navIcon: 'scroll-text', active: pageId === 'logs' })] }],
      footer: [],
      activeId: pageId,
      go() {},
    },
    chrome: {
      siteTitle: 'PraisonAI',
      siteLogo: null,
      openPalette() {},
      toggleColorMode() {},
      Slot,
      mainId: 'aiui-main',
    },
    viewport,
    layout: { id: 'workbench', available: [{ id: 'workbench', title: 'Quiet Workbench', source: 'builtin.layout-workbench', home: 'chat' }], switchTo() {} },
  }
}

const render = (p: LayoutProps) => renderToStaticMarkup(createElement(WorkbenchFrame, p))

// ── view model ───────────────────────────────────────────────────────

test('the descriptor asks the chat for a frame session list, the quiet thread and inline approvals', () => {
  assert.equal(workbenchLayout.id, 'workbench')
  assert.equal(workbenchLayout.meta.title, 'Quiet Workbench')
  assert.deepEqual(workbenchLayout.meta.chat, { sessions: 'frame', thread: 'quiet', approvals: 'inline' })
  assert.equal(workbenchLayout.meta.approvals, undefined, 'approvals still toast for other chats')
})

test('chatPageOf: the layout’s home from the server, else chat', () => {
  assert.equal(chatPageOf({ id: 'workbench', available: [{ id: 'workbench', title: 'W', source: 'builtin', home: 'talk' }] }), 'talk')
  assert.equal(chatPageOf({ id: 'workbench', available: [] }), 'chat')
})

test('frameTitle: the open chat on the chat page, New chat with none, else the page title', () => {
  const base = { chatPage: 'chat', siteTitle: 'PraisonAI', page: { title: 'Chat' } }
  assert.equal(frameTitle({ ...base, pageId: 'chat', sessions: SESSIONS }), 'Compare sorting algorithms')
  assert.equal(frameTitle({ ...base, pageId: 'chat', sessions: { ...SESSIONS, activeId: null } }), 'New chat')
  assert.equal(frameTitle({ ...base, pageId: 'chat', sessions: { ...SESSIONS, activeId: 'gone' } }), 'Chat', 'a session not listed yet')
  assert.equal(frameTitle({ ...base, pageId: 'chat', sessions: null }), 'Chat', 'no sessions feed: the page title')
  assert.equal(frameTitle({ ...base, pageId: 'logs', page: { title: 'Logs' }, sessions: SESSIONS }), 'Logs')
  assert.equal(frameTitle({ ...base, pageId: 'x', page: undefined, sessions: null }), 'PraisonAI')
})

test('agentOf: the last reply’s agent, else the session’s, else none', () => {
  const msg = (role: 'user' | 'assistant', agentName?: string) => ({ id: role + (agentName ?? ''), role, parts: [], createdAt: 0, agentName })
  const chat = (messages: ReturnType<typeof msg>[]): ChatState => ({ sessionId: 'sort', messages, isRunning: false })
  assert.equal(agentOf(chat([msg('assistant', 'Planner'), msg('user'), msg('assistant', 'Coder')]), SESSIONS), 'Coder')
  assert.equal(agentOf(chat([msg('user')]), SESSIONS), 'Researcher')
  assert.equal(agentOf(null, { ...SESSIONS, activeId: 'notes' }), undefined)
  assert.equal(agentOf(null, null), undefined)
})

test('waitingSessionIds and modelsByAgent', () => {
  assert.deepEqual([...waitingSessionIds([{ id: 'a', sessionId: 's1' }, { id: 'b' }, { id: 'c', sessionId: 's1' }])], ['s1'])
  const m = modelsByAgent({ agents: [{ name: 'Researcher', id: 'res', model: 'gpt-4o-mini' }, { name: 'NoModel' }, null] })
  assert.equal(m.get('researcher'), 'gpt-4o-mini')
  assert.equal(m.get('res'), 'gpt-4o-mini')
  assert.equal(m.has('nomodel'), false)
  assert.equal(modelsByAgent([{ name: 'A', model: 'm' }]).get('a'), 'm', 'a bare list')
  assert.equal(modelsByAgent(null).size, 0)
})

test('shortcuts: ⌘N / Ctrl+N new chat, ⌘B / Ctrl+B the sidebar', () => {
  const ev = (key: string, o: Partial<KeyboardEvent> = {}) =>
    ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent
  assert.equal(matchesShortcut(ev('n', { metaKey: true }), SHORTCUTS.newChat, true), true)
  assert.equal(matchesShortcut(ev('n', { ctrlKey: true }), SHORTCUTS.newChat, false), true)
  assert.equal(matchesShortcut(ev('n', { ctrlKey: true, shiftKey: true }), SHORTCUTS.newChat, false), false)
  assert.equal(matchesShortcut(ev('b', { metaKey: true }), SHORTCUTS.toggleSidebar, true), true)
  assert.equal(matchesShortcut(ev('b'), SHORTCUTS.toggleSidebar, true), false)
})

// ── the frame ────────────────────────────────────────────────────────

test('desktop: sidebar with brand, New chat ⌘N, primary pages, More, Chats; top bar title and actions; the page', () => {
  provideLayoutData('sessions', sessionsFeed())
  provideLayoutData('chat', chatFeed())
  const out = render(props('chat'))
  assert.match(out, /data-aiui-layout-frame="workbench" data-viewport="desktop"/)
  assert.match(out, /<nav aria-label="Main" data-aiui-workbench-sidebar=""/)
  assert.match(out, />PraisonAI</)
  assert.match(out, /aria-label="Collapse sidebar"/)
  assert.match(out, /data-aiui-new-chat=""[\s\S]*?New chat[\s\S]*?data-aiui-shortcut="mod\+n"/)
  // primary pages in order, with their icons; the current one marked
  for (const id of ['chat', 'agents', 'knowledge', 'runs', 'config']) assert.match(out, new RegExp(`data-aiui-nav-item="${id}"`))
  assert.match(out, /<a href="\/chat" aria-current="page" data-aiui-nav-item="chat"[^>]*>.*?lucide-message-square/)
  assert.match(out, /<details[^>]*><summary[^>]*>More \(1\)<\/summary>/)
  assert.match(out, /<h2[^>]*>Chats<\/h2>/)
  assert.match(out, /aria-current="true" data-aiui-session="sort"/)
  assert.match(out, /role="status" data-aiui-connection="online"/)
  assert.match(out, /Search and more<\/span>[\s\S]*?data-aiui-shortcut="mod\+k"/)
  assert.match(out, /aria-label="Switch light or dark theme"/)
  assert.match(out, /data-slot-name="sidebar:footer"/)
  // top bar
  assert.match(out, /<h1[^>]*>Compare sorting algorithms<\/h1>/)
  assert.match(out, /<span class="sr-only">Agent: <\/span>.*?Researcher/, 'the session’s agent until a reply names one')
  assert.match(out, /data-slot-name="header:actions"/)
  assert.match(out, /aria-label="More: search pages and commands"/)
  // the routed page in the main landmark
  assert.match(out, /<main id="aiui-main" tabindex="-1"[^>]*><div data-outlet="chat">/)
})

test('desktop, another page: its title, no chat meta, the chat list still in the sidebar', () => {
  provideLayoutData('sessions', sessionsFeed())
  const out = render(props('logs', 'desktop', 'Logs'))
  assert.match(out, /<h1[^>]*>Logs<\/h1>/)
  assert.doesNotMatch(out, /data-aiui-chat-meta/)
  assert.match(out, /data-aiui-session="sort"/)
  assert.match(out, /<div data-outlet="logs">/)
})

test('a session with a pending approval is marked Waiting in the chat list', () => {
  provideLayoutData('sessions', sessionsFeed())
  provideLayoutData('approvals', approvalsFeed(['notes']))
  assert.match(render(props('chat')), /data-aiui-session="notes"[^>]*>.*?Waiting/)
})

test('without the chat built-in: no New chat, no chat list, the page title; nothing crashes', () => {
  const out = render(props('chat'))
  assert.doesNotMatch(out, /data-aiui-new-chat/)
  assert.doesNotMatch(out, /data-aiui-session-list/)
  assert.match(out, /<h1[^>]*>Chat<\/h1>/)
  assert.match(out, /data-aiui-nav-item="agents"/)
})

test('phone: a 56 px header with 44 px menu and New chat, the title and agent line; no sidebar until the menu opens', () => {
  provideLayoutData('sessions', sessionsFeed())
  provideLayoutData('chat', chatFeed())
  const out = render(props('chat', 'phone'))
  assert.match(out, /data-aiui-layout-frame="workbench" data-viewport="phone"/)
  assert.match(out, /<header class="[^"]*h-14/)
  assert.match(out, /<button[^>]*class="[^"]*size-11[^"]*"[^>]*aria-label="Open menu" aria-haspopup="dialog" aria-expanded="false"/)
  assert.match(out, /class="[^"]*size-11[^"]*"[^>]*aria-label="New chat"/)
  assert.match(out, /<h1[^>]*>Compare sorting algorithms<\/h1>/)
  assert.match(out, /data-aiui-chat-meta=""[^>]*>Researcher</)
  assert.doesNotMatch(out, /data-aiui-workbench-sidebar/, 'the sidebar lives in the sheet')
  assert.doesNotMatch(out, /data-aiui-phone-sheet/, 'the sheet mounts on first open')
  assert.match(out, /<main id="aiui-main"/)
})
