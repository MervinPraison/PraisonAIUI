// The layout kit v1: nav rows, sessions over the feed, phone tabs, the
// explained approval card, shortcuts; v2 (Track W): page icons, times and
// Waiting in the session list, the connection line, the brand, feed hooks.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ICON_BY_NAME } from '@/lib/pageIcons'
import { provideLayoutData, resetLayoutsForTests, type LayoutNavItem } from '@/sdk/layouts'
import type { SessionsFeed, SessionsState } from '@/sdk/layoutTypes'
import {
  ApprovalCard,
  Brand,
  ConnectionStatus,
  describeCall,
  iconForNavItem,
  matchesShortcut,
  NavIcon,
  NavList,
  parseShortcut,
  PhoneSheet,
  PhoneTabs,
  relativeTime,
  SessionList,
  shortcutLabels,
  useApprovals,
  useChat,
  useMinuteClock,
} from '@/app-layouts/kit'

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el)

beforeEach(() => resetLayoutsForTests())

const item = (id: string, extra: Partial<LayoutNavItem> = {}): LayoutNavItem => ({
  id,
  title: id[0].toUpperCase() + id.slice(1),
  group: 'Main',
  href: `/${id}`,
  active: false,
  ...extra,
})

test('NavList: links with hrefs, the current page marked, 44 px rows on touch', () => {
  const out = html(createElement(NavList, { items: [item('chat', { active: true }), item('logs', { badge: 3 })], go: () => {} }))
  assert.match(out, /<a href="\/chat" aria-current="page" data-aiui-nav-item="chat"/)
  assert.match(out, /href="\/logs"(?![^>]*aria-current)/)
  assert.match(out, /aria-label="3 new">3</)
  assert.match(out, /h-8 text-sm/)
  assert.match(html(createElement(NavList, { items: [item('chat')], go: () => {}, size: 'touch' })), /h-11 text-\[15px\]/)
  assert.equal(html(createElement(NavList, { items: [], go: () => {} })), '')
})

function sessionsFeed(state: Partial<SessionsState>): SessionsFeed & { selected: (string | null)[] } {
  const full: SessionsState = { sessions: [], activeId: null, runningIds: new Set(), loading: false, ...state }
  const selected: (string | null)[] = []
  return {
    selected,
    get: () => full,
    subscribe: () => () => {},
    select: (id) => void selected.push(id),
    create: () => {},
    rename: async () => {},
    remove: async () => {},
    refresh: async () => {},
  }
}

test('SessionList renders nothing while no sessions provider is on', () => {
  assert.equal(html(createElement(SessionList, {})), '')
})

test('SessionList lists the feed’s chats, the active one marked, running ones labelled', () => {
  provideLayoutData(
    'sessions',
    sessionsFeed({
      sessions: [
        { id: 's1', title: 'Compare sorting algorithms' },
        { id: 's2', title: 'Weekly metrics' },
        { id: 's3', title: 'Old one' },
      ],
      activeId: 's1',
      runningIds: new Set(['s2']),
    }),
  )
  const out = html(createElement(SessionList, { limit: 2, title: 'Recent chats' }))
  assert.match(out, />Recent chats</)
  assert.match(out, /aria-current="true" data-aiui-session="s1"/)
  assert.match(out, /data-aiui-session="s2".*Running/)
  assert.doesNotMatch(out, /Old one/, 'limit applies')
})

test('SessionList shows a skeleton while loading and a note when empty', () => {
  provideLayoutData('sessions', sessionsFeed({ loading: true }))
  assert.match(html(createElement(SessionList, {})), /role="status" aria-label="Loading chats"/)
  resetLayoutsForTests()
  provideLayoutData('sessions', sessionsFeed({}))
  assert.match(html(createElement(SessionList, {})), /No chats yet\./)
})

test('PhoneTabs: equal columns, the current tab marked, badges', () => {
  const out = html(
    createElement(PhoneTabs, {
      tabs: [
        { id: 'home', label: 'Home', onSelect: () => {} },
        { id: 'chat', label: 'Chat', active: true, onSelect: () => {} },
        { id: 'ok', label: 'Approvals', badge: 2, onSelect: () => {} },
      ],
    }),
  )
  assert.match(out, /<nav aria-label="Main" data-aiui-phone-tabs=""/)
  assert.match(out, /grid-template-columns:repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(out, /aria-current="page" data-aiui-tab="chat"/)
  assert.match(out, /aria-label="2 pending">2</)
  assert.match(out, /min-h-11/)
})

test('PhoneSheet mounts nothing (and loads no dialog code) until first opened', () => {
  assert.equal(html(createElement(PhoneSheet, { open: false, onOpenChange: () => {}, title: 'Menu', children: 'nav' })), '')
})

test('ApprovalCard explains who wants what, shows the call, offers Not now / Approve', () => {
  const out = html(
    createElement(ApprovalCard, {
      item: {
        id: 'ap1',
        agentName: 'Researcher',
        toolName: 'shell',
        description: 'Researcher wants to install numpy to run the benchmark.',
        args: { cmd: 'pip install numpy' },
        riskLevel: 'high',
      },
      onApprove: () => {},
      onDeny: () => {},
    }),
  )
  assert.match(out, /role="group" aria-labelledby="aiui-approval-ap1-h"/)
  assert.match(out, /Allow Researcher to use shell\?/)
  assert.match(out, /<code[^>]*>pip install numpy<\/code>/)
  assert.match(out, /Risk: high/)
  assert.match(out, />Not now</)
  assert.match(out, />Approve</)
})

test('describeCall: a single string argument is the call; otherwise tool(args), capped', () => {
  assert.equal(describeCall({ toolName: 'shell', args: { cmd: 'ls -la' } }), 'ls -la')
  assert.equal(describeCall({ toolName: 'search', args: { q: 'x', n: 2 } }), 'search({"q":"x","n":2})')
  assert.equal(describeCall({ toolName: 'ping' }), 'ping()')
  assert.equal(describeCall({ toolName: 'shell', args: { cmd: 'x'.repeat(300) } }).length, 200)
})

test('shortcuts: mod is ⌘ on Apple platforms and Ctrl elsewhere', () => {
  assert.deepEqual(parseShortcut('mod+shift+K'), { key: 'k', mod: true, shift: true, alt: false })
  const ev = (key: string, o: Partial<KeyboardEvent> = {}) =>
    ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o }) as KeyboardEvent
  assert.equal(matchesShortcut(ev('n', { metaKey: true }), 'mod+n', true), true)
  assert.equal(matchesShortcut(ev('n', { ctrlKey: true }), 'mod+n', true), false)
  assert.equal(matchesShortcut(ev('n', { ctrlKey: true }), 'mod+n', false), true)
  assert.equal(matchesShortcut(ev('N', { ctrlKey: true, shiftKey: true }), 'mod+n', false), false)
  assert.equal(matchesShortcut(ev('?', { shiftKey: true }), '?', false), true, 'a shifted symbol needs no shift+')
  assert.equal(matchesShortcut(ev('1', { metaKey: true }), 'mod+1', true), true)
  assert.deepEqual(shortcutLabels('mod+k', true), ['⌘', 'K'])
  assert.deepEqual(shortcutLabels('mod+shift+enter', false), ['Ctrl', 'Shift', 'Enter'])
})

test('relativeTime: Now, minutes, hours today, Yesterday, a weekday, then a date', () => {
  const now = new Date(2026, 0, 15, 10, 0, 0).getTime() // Thu 15 Jan 2026, 10:00 local
  const at = (d: number, h: number, m = 0) => new Date(2026, 0, d, h, m).getTime()
  assert.equal(relativeTime(undefined, now), '')
  assert.equal(relativeTime(now + 5_000, now), 'Now', 'a clock skew counts as now')
  assert.equal(relativeTime(now - 30_000, now), 'Now')
  assert.equal(relativeTime(now - 5 * 60_000, now), '5m')
  assert.equal(relativeTime(at(15, 8), now), '2h')
  assert.equal(relativeTime(at(14, 23), now), 'Yesterday')
  assert.equal(relativeTime(at(12, 9), now), 'Mon')
  assert.equal(relativeTime(at(2, 9), now), 'Jan 2')
  assert.equal(relativeTime(new Date(2025, 11, 31).getTime(), now), 'Dec 31, 2025')
})

test('NavIcon: a lucide icon for navIcon, else the emoji, else the first letter', () => {
  assert.match(html(createElement(NavIcon, { item: { title: 'Chat', navIcon: 'message-square' } })), /<svg[^>]*lucide-message-square/)
  assert.match(html(createElement(NavIcon, { item: { title: 'Mine', icon: 'bot' } })), /lucide-bot/, 'a name in icon works too')
  assert.match(html(createElement(NavIcon, { item: { title: 'Fun', icon: '🎉' } })), />🎉</)
  assert.match(html(createElement(NavIcon, { item: { title: 'weather' } })), />W</)
  assert.equal(iconForNavItem({ navIcon: 'no-such-icon' }), undefined)
})

test('iconForNavItem reads the one shared table (lib/pageIcons), the same as the shell sidebar', () => {
  for (const [name, icon] of Object.entries(ICON_BY_NAME)) {
    assert.equal(iconForNavItem({ navIcon: name }), icon, name)
    assert.equal(iconForNavItem({ icon: ` ${name.toUpperCase()} ` }), icon, `${name} in icon`)
  }
})

test('NavList draws page icons by default, the active one in the accent', () => {
  const out = html(createElement(NavList, { items: [item('chat', { active: true, navIcon: 'message-square' })], go: () => {} }))
  assert.match(out, /lucide-message-square[^"]*text-primary/)
})

test('SessionList: times, a search box with its icon, Waiting for a pending approval', () => {
  const now = new Date(2026, 0, 15, 10, 0).getTime()
  provideLayoutData(
    'sessions',
    sessionsFeed({
      sessions: [
        { id: 's1', title: 'Compare sorting algorithms', updatedAt: now - 10_000 },
        { id: 's2', title: 'Quick: summarise release notes', updatedAt: now - 2 * 3_600_000 },
        { id: 's3', title: 'Quick: draft a reply to Sam', updatedAt: now - 3_600_000 },
      ],
      activeId: 's1',
    }),
  )
  const out = html(createElement(SessionList, { title: 'Chats', search: true, showTime: true, now, waitingIds: new Set(['s3']) }))
  assert.match(out, /<h2[^>]*>Chats<\/h2>/)
  assert.match(out, /lucide-search/)
  assert.match(out, /aria-label="Search chats"/)
  assert.match(out, /data-aiui-session="s1".*?>Now</)
  assert.match(out, /data-aiui-session="s2".*?>2h</)
  assert.match(out, /data-aiui-session="s3".*?Waiting/)
  assert.doesNotMatch(html(createElement(SessionList, {})), /tabular-nums">Now/, 'no times unless asked')
})

test('ConnectionStatus says Connected while the browser is online', () => {
  const out = html(createElement(ConnectionStatus, { detail: 'local' }))
  assert.match(out, /role="status" data-aiui-connection="online"/)
  assert.match(out, /Connected/)
  assert.match(out, /· <!-- -->local|· local/)
})

test('Brand: the logo image, else the title’s first letter', () => {
  assert.match(html(createElement(Brand, { chrome: { siteTitle: 'PraisonAI', siteLogo: null } })), />P<\/span><span[^>]*>PraisonAI</)
  assert.match(html(createElement(Brand, { chrome: { siteTitle: 'X', siteLogo: { kind: 'img', value: '/logo.svg' } } })), /<img src="\/logo.svg" alt=""/)
})

test('useMinuteClock reads the real time and stays stable between ticks', () => {
  const seen: number[] = []
  function Probe() {
    seen.push(useMinuteClock(), useMinuteClock())
    return null
  }
  const before = Date.now()
  html(createElement(Probe))
  assert.equal(seen[0], seen[1])
  assert.ok(seen[0] >= before - 60_000 && seen[0] <= Date.now())
})

test('useChat / useApprovals are null while nothing provides the feed', () => {
  const seen: unknown[] = []
  function Probe() {
    seen.push(useChat(), useApprovals())
    return null
  }
  html(createElement(Probe))
  assert.deepEqual(seen, [null, null])
})
