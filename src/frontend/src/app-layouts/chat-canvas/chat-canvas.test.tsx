// The Chat and Canvas layout (ADR 0003, track CC): its descriptor and chat
// presentation, the frame's nav mapping, title line and keys, and the
// artifacts feed seam with track A.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { chatCanvasLayout, chatCanvasPresentation, ARTIFACT_CARDS, CANVAS_PANEL } from '@/builtin/layouts/chat-canvas'
import {
  activateLayout,
  getActiveLayout,
  provideLayoutData,
  registerLayout,
  resetLayoutsForTests,
  type LayoutNavItem,
  type LayoutProps,
} from '@/sdk/layouts'
import type { Artifact, ArtifactsFeed, ChatFeed, ChatState, Feed, SessionsFeed, SessionsState } from '@/sdk/layoutTypes'
import Frame from './Frame'
import { countIndex, toArtifactsFeed, withLiveCount } from './data'
import { chatRowMeta, chatSubtitle, connectionWord, lastAgent, relativeTime, shortTime, summarizeArtifacts } from './format'
import { artifactsInChat, frameKeyAction, optionVars } from './frameLogic'
import { iconFor } from './iconMap'

beforeEach(() => resetLayoutsForTests())

// ── descriptor ───────────────────────────────────────────────────────

test('the descriptor: chat in the frame, bubbles, approval cards; the frame loads lazily', () => {
  assert.equal(chatCanvasLayout.id, 'chat-canvas')
  const chat = chatCanvasLayout.meta.chat
  assert.ok(chat)
  assert.equal(chat.sessions, 'frame')
  assert.equal(chat.thread, 'bubbles')
  assert.equal(chat.approvals, 'card')
  assert.equal(typeof chatCanvasLayout.load, 'function')
  // The SDK accepts the meta as it is (normalizeMeta validates enums and regions).
  registerLayout(chatCanvasLayout.id, chatCanvasLayout.meta, chatCanvasLayout.load)
  activateLayout('chat-canvas')
  assert.equal(getActiveLayout()?.meta.chat?.thread, 'bubbles')
})

test('without the artifacts feature in the build there is no canvas and no cards (the chat still works)', () => {
  const chat = chatCanvasPresentation({})
  assert.equal(chat.aside, undefined)
  assert.equal(chat.turnFooter, undefined)
  assert.equal(chat.asideLabel, undefined)
})

test('with the artifacts feature the canvas is the aside (phone: Chat | Canvas) and the cards follow each answer', async () => {
  const Panel: ComponentType = () => null
  const panel = async () => ({ default: Panel })
  const cards = async () => ({ default: Panel })
  const chat = chatCanvasPresentation({ [CANVAS_PANEL]: panel, [ARTIFACT_CARDS]: cards })
  assert.equal(chat.aside, panel)
  assert.equal(chat.turnFooter, cards)
  assert.equal(chat.asideLabel, 'Canvas')
  assert.equal((await chat.aside!()).default, Panel)
  // Only the panel: a canvas, no cards.
  assert.equal(chatCanvasPresentation({ [CANVAS_PANEL]: panel }).turnFooter, undefined)
})

// ── format ───────────────────────────────────────────────────────────

const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime() // a Sunday, local time

test('shortTime: the chat list time is compact (now, 5m, 2h, Yesterday)', () => {
  assert.equal(shortTime(NOW - 20_000, NOW), 'now')
  assert.equal(shortTime(NOW - 5 * 60_000, NOW), '5m')
  assert.equal(shortTime(NOW - 2 * 3_600_000, NOW), '2h')
  assert.equal(shortTime(new Date(2026, 10, 14, 18).getTime(), NOW), 'Yesterday')
  assert.equal(shortTime(undefined, NOW), undefined)
})

test('relativeTime: now, minutes, hours, yesterday, weekday, date; nothing for none or the future', () => {
  assert.equal(relativeTime(NOW - 20_000, NOW), 'now')
  assert.equal(relativeTime(NOW - 5 * 60_000, NOW), '5 min ago')
  assert.equal(relativeTime(NOW - 2 * 3_600_000, NOW), '2 h ago')
  assert.equal(relativeTime(new Date(2026, 10, 14, 18).getTime(), NOW), 'Yesterday')
  assert.equal(relativeTime(new Date(2026, 10, 9, 9).getTime(), NOW), 'Mon')
  assert.equal(relativeTime(new Date(2026, 2, 12).getTime(), NOW), '12 Mar')
  assert.equal(relativeTime(undefined, NOW), undefined)
  assert.equal(relativeTime(NOW + 10 * 60_000, NOW), undefined)
})

const artifact = (key: string, version: number, updatedAt?: number): Artifact => ({
  key,
  kind: 'code',
  title: key,
  version,
  sessionId: 's1',
  messageId: 'm1',
  updatedAt,
})

test('summarizeArtifacts counts keys, not versions, and keeps the newest change', () => {
  const s = summarizeArtifacts([artifact('table', 1, NOW - 9e5), artifact('table', 2, NOW - 1.2e5), artifact('sort_demo.py', 1, NOW - 3e5)])
  assert.deepEqual(s, { count: 2, updatedAt: NOW - 1.2e5 })
  assert.deepEqual(summarizeArtifacts([]), { count: 0 })
  assert.deepEqual(summarizeArtifacts(null), { count: 0 })
})

test('chatSubtitle: "Researcher · 3 artifacts · edited 2 min ago", parts left out when unknown', () => {
  assert.equal(chatSubtitle({ agent: 'Researcher', artifacts: 3, editedAt: NOW - 2 * 60_000 }, NOW), 'Researcher · 3 artifacts · edited 2 min ago')
  assert.equal(chatSubtitle({ agent: 'Researcher', artifacts: 1, editedAt: NOW }, NOW), 'Researcher · 1 artifact · edited just now')
  assert.equal(chatSubtitle({ agent: 'Researcher', running: true }, NOW), 'Researcher · working')
  assert.equal(chatSubtitle({ artifacts: 0, editedAt: NOW }, NOW), '')
})

test('lastAgent: the newest assistant message that names its agent', () => {
  const m = (role: 'user' | 'assistant', agentName?: string) => ({ id: role + agentName, role, parts: [], createdAt: 0, agentName })
  assert.equal(lastAgent([m('assistant', 'Planner'), m('user'), m('assistant', 'Researcher'), m('assistant')]), 'Researcher')
  assert.equal(lastAgent([m('user')]), undefined)
  assert.equal(lastAgent(null), undefined)
})

// ── options, keys, icons ─────────────────────────────────────────────

test('optionVars maps layout.options.chat-canvas collapse thresholds to CSS variables; junk is ignored', () => {
  assert.deepEqual(optionVars({ collapseLines: 20, collapseRows: 8 }), { '--cc-collapse-lines': '20', '--cc-collapse-rows': '8' })
  assert.deepEqual(optionVars({ collapseLines: -1, collapseRows: 'x' }), {})
  assert.deepEqual(optionVars(undefined), {})
})

test('the artifacts index: per-chat counts and the total; the open chat\'s live count wins', () => {
  const index = countIndex({ count: 3, artifacts: [{ sessionId: 'a' }, { sessionId: 'a' }, { sessionId: 'b' }, { key: 'x' }] })
  assert.equal(index.total, 3)
  assert.deepEqual([...index.bySession], [['a', 2], ['b', 1]])
  assert.deepEqual(countIndex(null), { total: undefined, bySession: new Map() })
  const live = withLiveCount(index, { sessionId: 'c', count: 2 })
  assert.equal(live.total, 5)
  assert.equal(live.bySession.get('c'), 2)
  assert.equal(withLiveCount(index, { sessionId: 'a', count: 2 }), index, 'unchanged: the same object')
  assert.equal(withLiveCount(index, null), index)
  assert.equal(chatRowMeta(3, 'now'), '3 artifacts · now')
  assert.equal(chatRowMeta(1, undefined), '1 artifact')
  assert.equal(chatRowMeta(0, 'Yesterday'), 'Yesterday')
  assert.equal(chatRowMeta(undefined, undefined), undefined)
})

test('artifactsInChat: the card (the design) unless layout.options says inline', () => {
  assert.equal(artifactsInChat(undefined), 'card')
  assert.equal(artifactsInChat({ artifactsInChat: 'inline' }), 'inline')
  assert.equal(artifactsInChat({ artifactsInChat: 'junk' }), 'card')
})

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
})

test('keys: ⌘N starts a chat, ⌘B toggles the sidebar (Ctrl off a Mac); neither on a phone or without the feed', () => {
  const desk = { phone: false, canCreate: true, mac: true }
  assert.equal(frameKeyAction(key('n', { metaKey: true }), desk), 'new-chat')
  assert.equal(frameKeyAction(key('b', { metaKey: true }), desk), 'toggle-sidebar')
  assert.equal(frameKeyAction(key('b', { ctrlKey: true }), { ...desk, mac: false }), 'toggle-sidebar')
  assert.equal(frameKeyAction(key('b', { ctrlKey: true }), desk), null, 'Ctrl+B on a Mac is not ⌘B')
  assert.equal(frameKeyAction(key('n'), desk), null)
  assert.equal(frameKeyAction(key('n', { metaKey: true, shiftKey: true }), desk), null)
  assert.equal(frameKeyAction(key('n', { metaKey: true }), { ...desk, canCreate: false }), null)
  assert.equal(frameKeyAction(key('b', { metaKey: true }), { ...desk, phone: true }), null)
})

test('nav icons: navIcon, then a name in icon, then the page id; else none (the mark is drawn)', () => {
  assert.ok(iconFor({ id: 'x', navIcon: 'bot' }))
  assert.ok(iconFor({ id: 'x', icon: 'layers' }))
  assert.ok(iconFor({ id: 'artifacts' }))
  assert.equal(iconFor({ id: 'weather', icon: '🌦️' }), undefined)
})

// ── the artifacts feed seam ──────────────────────────────────────────

const feedObject: ArtifactsFeed = {
  forSession: () => ({ get: () => [], subscribe: () => () => {} }),
  open: () => {},
}

test('toArtifactsFeed takes `artifactsFeed`, a default feed or a default factory, and rejects anything else', () => {
  assert.equal(toArtifactsFeed({ artifactsFeed: feedObject }), feedObject)
  assert.equal(toArtifactsFeed({ default: feedObject }), feedObject)
  assert.equal(toArtifactsFeed({ default: () => feedObject }), feedObject)
  assert.throws(() => toArtifactsFeed({ default: { forSession: 1 } }), /no ArtifactsFeed/)
  assert.throws(() => toArtifactsFeed(undefined), /no ArtifactsFeed/)
})

// ── the frame ────────────────────────────────────────────────────────

const feed = <S,>(value: S): Feed<S> => ({ get: () => value, subscribe: () => () => {} })

function sessionsFeed(state: Partial<SessionsState>): SessionsFeed {
  const full: SessionsState = { sessions: [], activeId: null, runningIds: new Set(), loading: false, ...state }
  return { ...feed(full), select: () => {}, create: () => {}, rename: async () => {}, remove: async () => {}, refresh: async () => {} }
}

function chatFeed(state: ChatState): ChatFeed {
  return { ...feed(state), prefill: () => {}, cancel: async () => {}, resolveApproval: async () => {} }
}

const item = (id: string, title: string, extra: Partial<LayoutNavItem> = {}): LayoutNavItem => ({
  id,
  title,
  group: 'Main',
  href: `/${id}`,
  active: false,
  ...extra,
})

const PRIMARY = ['chat', 'artifacts', 'agents', 'cron', 'knowledge', 'sessions', 'config']

function props(over: Partial<LayoutProps> = {}): LayoutProps {
  const Outlet = () => createElement('div', { 'data-outlet': '' }, 'the page')
  return {
    Outlet,
    pageId: 'chat',
    page: { id: 'chat', title: 'Chat', kind: 'react' } as LayoutProps['page'],
    fullBleed: true,
    nav: {
      primary: PRIMARY.map((id, i) => item(id, id[0].toUpperCase() + id.slice(1), { active: i === 0 })),
      groups: [{ name: 'Control', folded: true, items: [item('logs', 'Logs', { group: 'Control' })] }],
      footer: [],
      activeId: 'chat',
      go: () => {},
    },
    chrome: {
      siteTitle: 'PraisonAI',
      siteLogo: null,
      openPalette: () => {},
      toggleColorMode: () => {},
      Slot: () => null,
      mainId: 'aiui-main',
    },
    viewport: 'desktop',
    layout: {
      id: 'chat-canvas',
      available: [{ id: 'chat-canvas', title: 'Chat and Canvas', source: 'builtin', home: 'chat', primary: PRIMARY }],
      switchTo: () => {},
    },
    ...over,
  }
}

function provideChat() {
  provideLayoutData(
    'sessions',
    sessionsFeed({
      sessions: [
        { id: 's1', title: 'Compare sorting algorithms', updatedAt: Date.now() },
        { id: 's2', title: 'Quick: weekly metrics' },
      ],
      activeId: 's1',
    }),
  )
  provideLayoutData(
    'chat',
    chatFeed({
      sessionId: 's1',
      isRunning: false,
      messages: [{ id: 'a1', role: 'assistant', parts: [], createdAt: 0, agentName: 'Researcher' }],
    }),
  )
  provideLayoutData('artifacts', {
    forSession: (sid) => feed(sid === 's1' ? [artifact('table', 1), artifact('table', 2, Date.now()), artifact('sort_demo.py', 1)] : []),
    open: () => {},
  })
}

const render = (p: LayoutProps) => renderToStaticMarkup(createElement(Frame, p))

test('desktop frame: sidebar landmark, New chat, at most 7 primary pages, chats, More, the main landmark and the page', () => {
  provideChat()
  const out = render(props())
  assert.match(out, /data-aiui-layout-frame="chat-canvas"/)
  assert.match(out, /<nav aria-label="Main"/)
  assert.match(out, /data-cc-new-chat=""[^>]*>.*New chat/)
  const primary = /<ul[^>]*aria-label="Primary"[^>]*>(.*?)<\/ul>/.exec(out)?.[1] ?? ''
  const links = primary.match(/data-aiui-nav-item="[^"]+"/g) ?? []
  assert.ok(links.length > 0 && links.length <= 7, `primary nav has ${links.length} items`)
  assert.match(primary, /href="\/chat" aria-current="page" data-aiui-nav-item="chat"/)
  assert.doesNotMatch(primary, /logs/, 'the other pages are under More (the palette), not in the primary list')
  assert.match(out, />Chats</)
  assert.match(out, /aria-current="true" data-aiui-session="s1"/)
  // Two lines per chat (the title over "n artifacts · when"); the open one has the accent fill and a primary edge.
  assert.match(out, /aria-current="true" data-aiui-session="s1" class="[^"]*flex-col[^"]*bg-sidebar-accent[^"]*inset_2px_0_0_var\(--primary\)/)
  assert.match(out, /data-aiui-session="s1"[^>]*>.*?Compare sorting algorithms<\/span><span[^>]*data-cc-chat-meta="">[^<]+<\/span>/)
  // The footer (Canvas.dc.html): More with ⌘K, then the connection line.
  assert.match(out, /data-cc-more=""[^>]*>.*?<span class="flex-1">More<\/span>.*?<\/button>/)
  assert.match(out, /data-aiui-connection="(online|offline)"/)
  assert.match(out, /<main id="aiui-main" tabindex="-1"/)
  assert.match(out, /data-outlet="">the page</)
})

test('desktop top bar on the chat page: the open chat, "Researcher · 2 artifacts · edited just now", search, the Canvas slot, Share, theme', () => {
  provideChat()
  const out = render(props())
  assert.match(out, /Search or run a command.*data-aiui-aside-slot="".*data-cc-share=""/, 'the chat\'s Canvas toggle goes between search and Share')
  assert.match(out, /<h1[^>]*data-cc-title="">Compare sorting algorithms<\/h1>/)
  // The agent, then the artifacts line (a dot and "reconnecting" sit between them only while the socket is not open).
  assert.match(out, /data-cc-subtitle=""><span class="truncate">Researcher<\/span><span aria-hidden="true">·<\/span><span class="truncate">2 artifacts · edited just now</)
  assert.match(out, /aria-label="Search or run a command"/)
  assert.match(out, /data-cc-share=""/)
  assert.match(out, /aria-label="Switch to (dark|light) theme"/)
  assert.match(out, /aria-label="Collapse sidebar"/)
})

test('another page: its title, no chat line; the frame still lists the chats', () => {
  provideChat()
  const out = render(props({ pageId: 'logs', page: { id: 'logs', title: 'Logs', kind: 'legacy' } as LayoutProps['page'], fullBleed: false }))
  assert.match(out, /data-cc-title="">Logs<\/h1>/)
  assert.doesNotMatch(out, /data-cc-subtitle/)
  assert.doesNotMatch(out, /data-cc-share/, 'Share is for the chat page only')
  assert.doesNotMatch(out, /data-aiui-aside-slot/)
  assert.match(out, /data-aiui-session="s1"/)
  assert.match(out, /<main[^>]*class="[^"]*overflow-y-auto/)
})

test('phone frame: a header with 44 px menu and New chat, no sidebar; the menu sheet mounts only when opened', () => {
  provideChat()
  const out = render(props({ viewport: 'phone' }))
  assert.match(out, /data-viewport="phone"/)
  assert.doesNotMatch(out, /<nav aria-label="Main"/)
  assert.match(out, /aria-label="Open menu and chats" aria-haspopup="dialog"/)
  assert.match(out, /class="[^"]*size-11[^"]*" aria-label="New chat"/)
  assert.match(out, /data-cc-title="">Compare sorting algorithms</)
  assert.doesNotMatch(out, /data-aiui-session=/, 'the chats are in the sheet, not mounted yet')
})

test('without any feed (chat and artifacts built-ins off) the frame still renders the page', () => {
  const out = render(props())
  assert.match(out, /data-cc-title="">New chat</)
  assert.doesNotMatch(out, /data-cc-new-chat/)
  assert.doesNotMatch(out, /data-cc-subtitle/)
  assert.match(out, /data-outlet="">the page</)
})

test('connectionWord: the top bar names the connection only while it is not open', () => {
  assert.equal(connectionWord('open'), null, 'open is the sidebar foot\'s "Connected" line')
  assert.deepEqual(connectionWord('connecting'), { word: 'connecting', tone: 'pending' })
  assert.deepEqual(connectionWord('closed'), { word: 'reconnecting', tone: 'pending' })
  assert.equal(connectionWord(undefined), null)
})
