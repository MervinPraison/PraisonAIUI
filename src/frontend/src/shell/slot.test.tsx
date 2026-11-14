// Slot hosts (shell/Slot.tsx): every registerSlot contribution renders, in
// order, isolated from the others; an empty slot renders nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement, lazy, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import { registerSlot } from '@/sdk/registry'
import { ShellHeader } from '@/shell/Header'
import { PageView } from '@/shell/PageView'
import { SidebarNav } from '@/shell/Sidebar'
import { SHELL_SLOTS, Slot, SlotBoundary, type SlotProps } from '@/shell/Slot'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis

const page = (id: string, extra: Partial<ShellPage> = {}): ShellPage => ({ id, title: id, kind: 'blocks', ...extra })

function Chip(label: string) {
  return function SlotChip({ slot, pageId, page: p }: SlotProps) {
    return (
      <span data-chip={label} data-slot={slot} data-page={pageId} data-title={p?.title ?? ''}>
        {label}
      </span>
    )
  }
}

const chips = (html: string): string[] => [...html.matchAll(/data-chip="([^"]+)"/g)].map((m) => m[1])

test('the shell hosts three slot names', () => {
  assert.equal(SHELL_SLOTS.headerActions, 'header:actions')
  assert.equal(SHELL_SLOTS.sidebarFooter, 'sidebar:footer')
  assert.equal(SHELL_SLOTS.pageToolbar('logs'), 'page:logs:toolbar')
})

test('an empty slot renders nothing at all', () => {
  assert.equal(renderToStaticMarkup(<Slot name="test:empty" pageId="logs" className="x" />), '')
})

test('two plugins contribute to one slot and render in order, with the slot props', () => {
  registerSlot('test:two', Chip('second'), { id: 'plugin-b', order: 20 })
  registerSlot('test:two', Chip('first'), { id: 'plugin-a', order: 10 })
  const html = renderToStaticMarkup(
    <Slot name="test:two" pageId="logs" page={page('logs', { title: 'Logs' })} extra={{ collapsed: true }} className="row" />,
  )
  assert.deepEqual(chips(html), ['first', 'second'])
  assert.match(html, /^<div data-aiui-slot="test:two" class="row">/)
  assert.match(html, /data-slot="test:two" data-page="logs" data-title="Logs"/)
})

test('a lazy contribution suspends on its own without hiding the others', () => {
  const Never = lazy(() => new Promise<{ default: () => ReactNode }>(() => {}))
  registerSlot('test:lazy', Never, { id: 'slow', order: 1 })
  registerSlot('test:lazy', Chip('ready'), { id: 'ready', order: 2 })
  const html = renderToStaticMarkup(<Slot name="test:lazy" pageId="" />)
  assert.deepEqual(chips(html), ['ready'])
})

test('a contribution that throws is dropped by its own boundary; the rest of the slot stays', () => {
  // Error boundaries do not run in server rendering, so drive the boundary
  // the way React does: getDerivedStateFromError, then render.
  assert.deepEqual(SlotBoundary.getDerivedStateFromError(), { failed: true })
  const boundary = new SlotBoundary({ slot: 'test:throw', id: 'broken', children: 'child' })
  assert.equal(boundary.render(), 'child')
  boundary.state = SlotBoundary.getDerivedStateFromError()
  assert.equal(boundary.render(), null, 'the failed contribution renders nothing')

  // Each contribution gets a boundary of its own (not one around the slot).
  registerSlot('test:throw', Chip('a'), { id: 'a' })
  registerSlot('test:throw', Chip('b'), { id: 'b' })
  const html = renderToStaticMarkup(<Slot name="test:throw" pageId="" />)
  assert.deepEqual(chips(html), ['a', 'b'])
})

test('the header renders header:actions before the search button', () => {
  const header = (pageId: string) =>
    renderToStaticMarkup(
      <ShellHeader
        title="Logs"
        pageId={pageId}
        page={page(pageId, { title: 'Logs' })}
        showMenuButton={false}
        onOpenMenu={() => {}}
        onPreloadMenu={() => {}}
      />,
    )
  assert.doesNotMatch(header('logs'), /data-aiui-slot/, 'no contribution: the header is unchanged')
  registerSlot(SHELL_SLOTS.headerActions, Chip('header-chip'), { id: 'test' })
  const html = header('logs')
  assert.match(html, /data-aiui-slot="header:actions"/)
  assert.match(html, /data-chip="header-chip" data-slot="header:actions" data-page="logs" data-title="Logs"/)
  assert.ok(html.indexOf('data-chip="header-chip"') < html.indexOf('Search pages and commands'))
})

test('the sidebar renders sidebar:footer below the navigation and passes `collapsed`', () => {
  const pages = [page('logs'), page('usage')]
  const nav = (collapsed: boolean) =>
    renderToStaticMarkup(<SidebarNav pages={pages} activeId="usage" collapsed={collapsed} />)
  assert.doesNotMatch(nav(false), /data-aiui-slot/)
  registerSlot(SHELL_SLOTS.sidebarFooter, function Footer({ collapsed, pageId }: SlotProps & { collapsed?: boolean }) {
    return <span data-footer={String(collapsed)} data-page={pageId} />
  })
  assert.match(nav(false), /data-aiui-slot="sidebar:footer"[^>]*><span data-footer="false" data-page="usage">/)
  assert.match(nav(true), /<span data-footer="true" data-page="usage">/)
  assert.ok(nav(false).indexOf('</nav>') < nav(false).indexOf('data-aiui-slot'))
})

test('a page shows its own page:<id>:toolbar slot only', () => {
  const manifest: Pick<ShellManifest, 'pages'> = { pages: [page('board'), page('other')] }
  const view = (pageId: string) =>
    renderToStaticMarkup(
      createElement(PageView, {
        pageId,
        page: manifest.pages.find((p) => p.id === pageId),
        pluginsSettled: true,
        fullBleed: false,
        firstPage: manifest.pages[0],
      }),
    )
  registerSlot(SHELL_SLOTS.pageToolbar('board'), Chip('board-tools'), { id: 'test' })
  assert.deepEqual(chips(view('board')), ['board-tools'])
  assert.match(view('board'), /data-aiui-slot="page:board:toolbar"/)
  assert.deepEqual(chips(view('other')), [])
  assert.doesNotMatch(view('other'), /data-aiui-slot/)
  assert.doesNotMatch(view('missing'), /data-aiui-slot/, 'an unknown page has no toolbar')
})
