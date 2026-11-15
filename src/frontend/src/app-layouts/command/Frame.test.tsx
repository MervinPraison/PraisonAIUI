// The Command Deck frame, rendered with the feeds it reads: desktop regions
// (header, rail, tabs, outlet, status bar), the phone frame, the chat-only
// regions, the approvals badge, and every provider off.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { provideLayoutData, resetLayoutsForTests, type LayoutNavItem, type LayoutProps } from '@/sdk/layouts'
import type { ApprovalsFeed, SessionsFeed, SessionsState } from '@/sdk/layoutTypes'
import { commandLayout } from '@/builtin/layouts/command'
import CommandFrame from './Frame'

const item = (id: string, extra: Partial<LayoutNavItem> = {}): LayoutNavItem => ({
  id,
  title: id[0].toUpperCase() + id.slice(1),
  group: 'Main',
  href: `/${id}`,
  active: false,
  ...extra,
})

function props(pageId: string, viewport: LayoutProps['viewport'] = 'desktop'): LayoutProps {
  const primary = ['chat', 'runs', 'agents', 'jobs', 'config'].map((id) => item(id, { active: id === pageId, navIcon: id === 'agents' ? 'bot' : undefined }))
  return {
    Outlet: () => createElement('div', { 'data-outlet': pageId }),
    pageId,
    fullBleed: false,
    viewport,
    nav: { primary, groups: [{ name: 'More', folded: true, items: [item('logs')] }], footer: [], activeId: pageId, go: () => {} },
    chrome: {
      siteTitle: 'PraisonAI',
      siteLogo: null,
      openPalette: () => {},
      toggleColorMode: () => {},
      Slot: ({ name }) => createElement('span', { 'data-slot': name }),
      mainId: 'aiui-main',
    },
    layout: { id: 'command', available: [{ id: 'command', title: 'Command Deck', source: 'builtin.layout-command', home: 'chat' }], switchTo: () => {} },
  }
}

function sessionsFeed(state: Partial<SessionsState>): SessionsFeed {
  const full: SessionsState = { sessions: [], activeId: null, runningIds: new Set(), loading: false, ...state }
  return { get: () => full, subscribe: () => () => {}, select: () => {}, create: () => {}, rename: async () => {}, remove: async () => {}, refresh: async () => {} }
}

const approvals = (n: number): ApprovalsFeed => ({
  get: () => ({ pending: Array.from({ length: n }, (_, i) => ({ id: `ap_${i}`, toolName: 'terminal', sessionId: 's1', args: { cmd: 'pip install numpy' } })) }),
  subscribe: () => () => {},
  approve: async () => {},
  deny: async () => {},
})

const html = (p: LayoutProps) => renderToStaticMarkup(createElement(CommandFrame, p))

beforeEach(() => resetLayoutsForTests())

test('the descriptor: dense thread, tab sessions, keyboard approvals, approvals shown by the frame', () => {
  assert.deepEqual(commandLayout.meta.chat, { sessions: 'tabs', thread: 'dense', approvals: 'keyboard' })
  assert.equal(commandLayout.meta.approvals, 'frame')
  assert.equal(commandLayout.meta.chat?.aside, undefined, 'the frame draws the inspector itself')
})

test('desktop chat: command bar, rail with G keys, session tabs, outlet, status bar', () => {
  provideLayoutData('sessions', sessionsFeed({
    sessions: [{ id: 's1', title: 'Compare sorting algorithms' }, { id: 's2', title: 'Quick: weekly metrics' }],
    activeId: 's1',
    runningIds: new Set(['s1']),
  }))
  provideLayoutData('approvals', approvals(1))
  const out = html(props('chat'))
  assert.match(out, /data-aiui-layout-frame="command" data-viewport="desktop"/)
  assert.match(out, /aria-label="PraisonAI home"/)
  // The bar is a lazy feature: its placeholder holds the place while it loads.
  assert.match(out, /<div aria-hidden="true" class="[^"]*h-10 rounded-md"/)
  assert.match(out, /<nav aria-label="Main" data-command-rail=""/)
  const rail = [...out.matchAll(/data-aiui-nav-item="(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(rail, ['chat', 'runs', 'agents', 'jobs', 'config'], 'at most seven primary items')
  assert.match(out, /href="\/chat" aria-current="page"/)
  assert.match(out, />G R</, 'the Runs tooltip names its key')
  assert.match(out, /aria-label="1 active run">1</, 'Runs counts active runs')
  assert.match(out, /aria-label="Keyboard shortcuts"/)
  // The rail's shortcuts button is labelled like the other rail items, not a cryptic "⌘/".
  assert.match(out, /data-command-shortcuts=""><svg[^>]*>.*?<\/svg><span[^>]*>Shortcuts<\/span>/)
  // No raw session id beside the Run panel toggle; the status bar is sans with tabular numbers.
  assert.doesNotMatch(out, /title="[0-9a-f-]{20,}"[^>]*class="font-mono"/)
  assert.match(out, /data-command-status=""[^>]*class="(?![^"]*font-mono)[^"]*tabular-nums/)
  assert.match(out, /role="tablist" aria-label="Open sessions"/)
  assert.match(out, /role="tab" aria-selected="true" aria-controls="aiui-main" tabindex="0"[^>]*data-session-tab="s1"/)
  assert.match(out, /data-session-tab="s1"[^>]*><span aria-hidden="true" class="[^"]*bg-warning/, 'the waiting session has the amber dot')
  assert.match(out, /aria-pressed="true"[^>]*data-command-run-toggle/, 'the run panel is open on a desktop')
  assert.match(out, /<main id="aiui-main" tabindex="-1"[^>]*><div data-outlet="chat"><\/div><\/main>/)
  assert.match(out, /data-command-approvals="">.*1 approval waiting/)
  assert.match(out, /data-command-status=""/)
  assert.match(out, /1 run active · 1 approval/)
  assert.match(out, /data-slot="header:actions"/)
})

test('a run paused at an approval gate counts as active: the status bar and the Runs badge', () => {
  // The thread store stops counting a turn as running once it pauses at a gate.
  provideLayoutData('sessions', sessionsFeed({ sessions: [{ id: 's1', title: 'Compare sorting algorithms' }], activeId: 's1', runningIds: new Set() }))
  provideLayoutData('approvals', approvals(1))
  const out = html(props('chat'))
  assert.match(out, /1 run active · 1 approval/)
  assert.match(out, /aria-label="1 active run">1</)
})

test('a non-chat page: no tabs and no inspector, the page in the outlet', () => {
  provideLayoutData('sessions', sessionsFeed({ sessions: [{ id: 's1', title: 'A' }], activeId: 's1' }))
  const out = html(props('logs'))
  assert.match(out, /data-outlet="logs"/)
  assert.doesNotMatch(out, /role="tablist"/)
  assert.doesNotMatch(out, /data-command-run-toggle/)
  assert.doesNotMatch(out, /aria-current="page"/, 'logs is not a rail page')
})

test('a tablet: the run panel starts closed', () => {
  provideLayoutData('sessions', sessionsFeed({ sessions: [{ id: 's1', title: 'A' }], activeId: 's1' }))
  assert.match(html(props('chat', 'tablet')), /aria-pressed="false"[^>]*data-command-run-toggle/)
})

test('every provider off: the frame still renders, with no tabs and no approvals', () => {
  const out = html(props('chat'))
  assert.match(out, /data-aiui-layout-frame="command"/)
  assert.doesNotMatch(out, /role="tablist"/)
  assert.doesNotMatch(out, /data-command-approvals/)
  assert.match(out, /0 runs active/)
  assert.doesNotMatch(out, /data-command-usage/, 'no ledger: no usage line')
})

test('phone: menu with the approvals dot, the bar, New chat, the n/m switcher; no rail or status bar', () => {
  provideLayoutData('sessions', sessionsFeed({
    sessions: [{ id: 's1', title: 'Compare sorting algorithms' }, { id: 's2', title: 'B' }, { id: 's3', title: 'C' }, { id: 's4', title: 'D' }],
    activeId: 's1',
  }))
  provideLayoutData('approvals', approvals(1))
  const out = html(props('chat', 'phone'))
  assert.match(out, /data-viewport="phone"/)
  assert.match(out, /aria-label="Open menu: destinations and sessions, 1 approval waiting"/)
  assert.match(out, /class="[^"]*size-11[^"]*"[^>]*aria-label="Open menu/)
  assert.match(out, /aria-label="New chat"/)
  assert.match(out, /aria-label="Switch session, 4 open"/)
  assert.match(out, /aria-label="Session 1 of 4">1<!-- -->\/<!-- -->4|aria-label="Session 1 of 4">1\/4/)
  assert.match(out, /Compare sorting algorithms/)
  assert.doesNotMatch(out, /data-command-rail/)
  assert.doesNotMatch(out, /data-command-status/)
  assert.doesNotMatch(out, /data-phone-sheet/, 'the sheet mounts on first open')
})

test('the run panel open on chat marks the frame (the paused strip turns into one line); the status bar says Connected', () => {
  provideLayoutData('sessions', sessionsFeed({ sessions: [{ id: 's1', title: 'One' }], activeId: 's1' }))
  const chat = html(props('chat'))
  assert.match(chat, /data-aiui-layout-frame="command"[^>]*data-run-panel="open"/)
  assert.match(chat, /data-command-status=""[\s\S]*Connected/)
  assert.doesNotMatch(chat, /online ·/)
  assert.doesNotMatch(html(props('logs')), /data-run-panel/)
})
