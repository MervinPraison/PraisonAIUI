// Mission Control frame: its model (which page fills the frame, nav counts,
// phone tabs, the banner's approval, health, shortcuts) and the frame's
// markup on desktop and phone.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { matchesShortcut } from '@/app-layouts/kit'
import { provideLayoutData, resetLayoutsForTests, type LayoutNav, type LayoutNavItem, type LayoutProps } from '@/sdk/layouts'
import type { ApprovalItem, ApprovalsFeed } from '@/sdk/layoutTypes'
import MissionFrame from './Frame'
import {
  approvalTitle,
  bannerApproval,
  environmentOf,
  frameContent,
  hasPage,
  healthOf,
  navCount,
  phoneNav,
  SHORTCUTS,
  waited,
} from './model'

beforeEach(() => resetLayoutsForTests())

const item = (id: string, extra: Partial<LayoutNavItem> = {}): LayoutNavItem => ({
  id,
  title: id[0].toUpperCase() + id.slice(1),
  group: 'Main',
  href: `/${id}`,
  active: false,
  ...extra,
})

const PRIMARY = ['overview', 'agents', 'approvals', 'chat', 'runs', 'sessions']

function nav(activeId: string): LayoutNav {
  return {
    primary: PRIMARY.map((id) => item(id, { active: id === activeId, navIcon: id === 'agents' ? 'bot' : undefined })),
    groups: [{ name: 'Tools', folded: false, items: [item('logs', { active: activeId === 'logs' })] }],
    footer: [item('settings')],
    activeId,
    go: () => {},
  }
}

test('the ops overview fills the frame on Mission’s home and on the ops-overview page', () => {
  assert.equal(frameContent('overview', { id: 'overview' }, 'overview'), 'ops')
  assert.equal(frameContent('overview', undefined, 'overview'), 'ops', 'the home renders even when its page is off')
  assert.equal(frameContent('overview', { id: 'ops-overview', replaces: 'overview' }, 'overview'), 'ops')
  assert.equal(frameContent('ops-overview', { id: 'ops-overview' }, 'overview'), 'ops')
  // A plugin page that replaces the home is the page, not the board.
  assert.equal(frameContent('overview', { id: 'my-home', replaces: 'overview' }, 'overview'), 'page')
  assert.equal(frameContent('chat', { id: 'chat' }, 'overview'), 'chat')
  assert.equal(frameContent('logs', { id: 'logs' }, 'overview'), 'page')
})

test('nav counts: agents and runs today in mono, approvals as a warning', () => {
  const counts = { agents: 3, runs: 42, approvals: 1 }
  assert.deepEqual(navCount(item('agents'), counts), { value: 3, warn: false, label: '3 agents' })
  assert.deepEqual(navCount(item('runs'), counts), { value: 42, warn: false, label: '42 runs today' })
  assert.deepEqual(navCount(item('approvals'), counts), { value: 1, warn: true, label: '1 waiting' })
  assert.equal(navCount(item('approvals'), { approvals: 0 }), null)
  assert.equal(navCount(item('agents'), { approvals: 0 }), null)
  assert.equal(navCount(item('chat'), counts), null)
})

test('phone tabs: the first four primary pages, then More with the rest', () => {
  const pn = phoneNav(nav('chat'))
  assert.deepEqual(pn.tabs.map((t) => t.id), ['overview', 'agents', 'approvals', 'chat'])
  assert.deepEqual(pn.more.map((t) => t.id), ['runs', 'sessions', 'settings'])
  assert.equal(pn.groups[0].items[0].id, 'logs')
  assert.equal(hasPage(nav('chat'), 'logs'), true)
  assert.equal(hasPage(nav('chat'), 'nope'), false)
})

test('the banner shows the oldest pending approval, never on the approvals page', () => {
  const a: ApprovalItem = { id: 'a', createdAt: 20 }
  const b: ApprovalItem = { id: 'b', createdAt: 10, agentName: 'Coder' }
  assert.equal(bannerApproval([a, b], 'chat')?.id, 'b')
  assert.equal(bannerApproval([a, b], 'approvals'), null)
  assert.equal(bannerApproval([], 'chat'), null)
  assert.equal(approvalTitle(b), 'Coder needs your approval to continue')
  assert.equal(approvalTitle(a), 'An agent needs your approval to continue')
  assert.equal(waited(42_000), '0:42')
  assert.equal(waited(75 * 60_000), '75:00')
})

test('environment option and provider health', () => {
  assert.equal(environmentOf({ options: { environment: ' prod ' } }), 'prod')
  assert.equal(environmentOf({ options: { environment: 7 } }), undefined)
  assert.equal(environmentOf(undefined), undefined)
  assert.deepEqual(healthOf({ status: 'ok', agents: 3 }), { state: 'ok', label: 'All systems live', agents: 3 })
  assert.equal(healthOf({ status: 'healthy' }).state, 'ok')
  assert.equal(healthOf({ status: 'error' }).state, 'degraded')
  assert.equal(healthOf(null).state, 'unknown')
})

test('keyboard: mod+n starts a chat, mod+j reaches the waiting approval', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods })
  assert.equal(matchesShortcut(key('n', { metaKey: true }), SHORTCUTS.newChat, true), true)
  assert.equal(matchesShortcut(key('n', { ctrlKey: true }), SHORTCUTS.newChat, false), true)
  assert.equal(matchesShortcut(key('j', { metaKey: true }), SHORTCUTS.approval, true), true)
  assert.equal(matchesShortcut(key('j'), SHORTCUTS.approval, true), false)
  assert.equal(matchesShortcut(key('j', { metaKey: true, shiftKey: true }), SHORTCUTS.approval, true), false)
})

// ── markup ───────────────────────────────────────────────────────────

function approvals(pending: ApprovalItem[]): ApprovalsFeed {
  const state = { pending }
  return { get: () => state, subscribe: () => () => {}, approve: async () => {}, deny: async () => {} }
}

function props(pageId: string, viewport: LayoutProps['viewport']): LayoutProps {
  return {
    Outlet: () => createElement('div', { 'data-outlet': pageId }),
    pageId,
    page: { id: pageId, title: pageId[0].toUpperCase() + pageId.slice(1), kind: 'legacy' } as LayoutProps['page'],
    fullBleed: false,
    nav: nav(pageId),
    chrome: {
      siteTitle: 'Acme Ops',
      siteLogo: null,
      openPalette: () => {},
      toggleColorMode: () => {},
      Slot: () => null,
      mainId: 'aiui-main',
    },
    viewport,
    layout: {
      id: 'mission',
      available: [{ id: 'mission', title: 'Mission Control', source: 'builtin.layout-mission', home: 'overview', options: { environment: 'prod' } }],
      switchTo: () => {},
    },
  }
}

test('desktop: top bar, nav with counts, the approval banner and the routed page', () => {
  provideLayoutData('approvals', approvals([{ id: 'ap_1', agentName: 'Coder', toolName: 'shell', args: { cmd: 'pip install numpy' }, createdAt: 1 }]))
  const out = renderToStaticMarkup(createElement(MissionFrame, props('logs', 'desktop')))
  assert.match(out, /data-aiui-layout-frame="mission" data-viewport="desktop"/)
  assert.match(out, /data-aiui-mission-topbar/)
  assert.match(out, />prod</, 'the environment badge')
  assert.match(out, /aria-label="Approvals, 1 waiting"/)
  assert.match(out, /aria-label="Approvals, 1 waiting"[^>]*data-aiui-nav-item="approvals"/)
  assert.match(out, /data-aiui-approval-banner="ap_1"/)
  assert.match(out, /Coder needs your approval to continue/)
  assert.match(out, /pip install numpy/)
  assert.match(out, /<main id="aiui-main"[^>]*><div data-outlet="logs">/)
  const primary = out.match(/<nav aria-label="Main"[\s\S]*?<\/nav>/)?.[0] ?? ''
  assert.ok((primary.match(/data-aiui-nav-item=/g) ?? []).length - 2 <= 7, 'at most 7 primary items')
})

test('desktop: no banner and no bell count without pending approvals; the board loads lazily', () => {
  provideLayoutData('approvals', approvals([]))
  const out = renderToStaticMarkup(createElement(MissionFrame, props('overview', 'desktop')))
  assert.doesNotMatch(out, /data-aiui-approval-banner/)
  assert.match(out, /aria-label="Approvals, none waiting"/)
  // The ops overview is a lazy board chunk: its skeleton renders first, never the legacy page.
  assert.match(out, /aria-label="Loading the overview"/)
  assert.doesNotMatch(out, /data-outlet=/)
})

test('phone: header with 44 px controls, four tabs and More, the approval card on top', () => {
  provideLayoutData('approvals', approvals([{ id: 'ap_1', agentName: 'Coder', createdAt: 1 }]))
  const out = renderToStaticMarkup(createElement(MissionFrame, props('chat', 'phone')))
  assert.match(out, /data-viewport="phone"/)
  const tabs = [...out.matchAll(/data-aiui-tab="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(tabs, ['overview', 'agents', 'approvals', 'chat', 'more'])
  assert.match(out, /aria-label="1 pending"/, 'the approvals tab badge')
  assert.match(out, /class="[^"]*size-11" aria-label="Search"/)
  assert.match(out, /data-aiui-approval-banner="ap_1"/)
  assert.match(out, /h-11 flex-1/, 'touch-size decision buttons')
  assert.doesNotMatch(out, /data-aiui-ops-column/, 'no ops column on a phone')
})
