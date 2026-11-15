// The layout kit v1: nav rows, sessions over the feed, phone tabs, the
// explained approval card, shortcuts.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { provideLayoutData, resetLayoutsForTests, type LayoutNavItem } from '@/sdk/layouts'
import type { SessionsFeed, SessionsState } from '@/sdk/layoutTypes'
import {
  ApprovalCard,
  describeCall,
  matchesShortcut,
  NavList,
  parseShortcut,
  PhoneSheet,
  PhoneTabs,
  SessionList,
  shortcutLabels,
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
