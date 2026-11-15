import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ShellPage } from '@/sdk/manifest'
import { buildLayoutNav, MAX_PRIMARY, navPagesForLayout, resolveRoutePage } from './layoutNav'
import { defaultPageId } from './nav'

const page = (id: string, extra: Partial<ShellPage> = {}): ShellPage => ({ id, title: id.toUpperCase(), kind: 'native', ...extra })

const PAGES: ShellPage[] = [
  page('home', { group: 'Main' }),
  page('talk', { group: 'Main', navIcon: 'message-square' }),
  page('board', { group: 'Main' }),
  page('logs', { group: 'Ops' }),
  page('tools', { group: 'Ops' }),
  page('inspect', { group: 'Ops', position: 'footer' } as Partial<ShellPage>),
  // owned by layout "alpha" only
  page('welcome', { group: 'Main', layouts: ['alpha'] }),
  // stands in for "board" while "beta" is active
  page('ops-board', { group: 'Ops', title: 'Ops board', layouts: ['beta'], replaces: 'board' }),
]

const ids = (pages: readonly { id: string }[]) => pages.map((p) => p.id)

test('the classic frame lists no layout-owned page', () => {
  assert.deepEqual(ids(navPagesForLayout(PAGES, '')), ['home', 'talk', 'board', 'logs', 'tools', 'inspect'])
})

test('a layout lists its own pages, not another layout’s', () => {
  assert.deepEqual(ids(navPagesForLayout(PAGES, 'alpha')), ['home', 'talk', 'board', 'logs', 'tools', 'inspect', 'welcome'])
})

test('a replacement takes the replaced page’s place, id and URL, with its own title', () => {
  const listed = navPagesForLayout(PAGES, 'beta')
  assert.deepEqual(ids(listed), ['home', 'talk', 'board', 'logs', 'tools', 'inspect'])
  const board = listed.find((p) => p.id === 'board')!
  assert.equal(board.title, 'Ops board')
  assert.equal(board.group, 'Main', 'it keeps the replaced page’s group')
})

test('a replacement whose target is missing is listed as itself', () => {
  const pages = PAGES.filter((p) => p.id !== 'board')
  assert.ok(ids(navPagesForLayout(pages, 'beta')).includes('ops-board'))
})

test('a URL resolves to its replacement only while that layout is active', () => {
  assert.equal(resolveRoutePage(PAGES, 'board', 'beta')?.id, 'ops-board')
  assert.equal(resolveRoutePage(PAGES, 'board', 'alpha')?.id, 'board')
  assert.equal(resolveRoutePage(PAGES, 'board', '')?.id, 'board')
  // a layout-owned URL renders under any layout, the classic frame included
  assert.equal(resolveRoutePage(PAGES, 'welcome', '')?.id, 'welcome')
  assert.equal(resolveRoutePage(PAGES, 'nope', 'beta'), undefined)
})

test('primary is the layout’s list ∩ listed pages, in its order, without footer pages', () => {
  const nav = buildLayoutNav({
    pages: PAGES,
    groups: { order: ['Main', 'Ops'], folded: ['Ops'] },
    spec: { id: 'alpha', primary: ['talk', 'welcome', 'missing', 'inspect', 'talk', 'ops-board'] },
    activeId: 'talk',
    go: () => {},
  })
  assert.deepEqual(ids(nav.primary), ['talk', 'welcome'])
  assert.equal(nav.primary[0].active, true)
  assert.equal(nav.primary[0].href, '/talk')
  assert.equal(nav.primary[0].navIcon, 'message-square')
  assert.equal(nav.primary[1].active, false)
  assert.deepEqual(
    nav.groups.map((g) => [g.name, g.folded, ids(g.items)]),
    [
      ['Main', false, ['home', 'board']],
      ['Ops', true, ['logs', 'tools']],
    ],
  )
  assert.deepEqual(ids(nav.footer), ['inspect'])
  assert.equal(nav.activeId, 'talk')
})

test('primary holds at most seven items; no primary list means everything is in groups', () => {
  const many = Array.from({ length: 10 }, (_, i) => page(`p${i}`, { group: 'G' }))
  const nav = buildLayoutNav({ pages: many, groups: {}, spec: { id: 'alpha', primary: ids(many) }, activeId: '', go: () => {} })
  assert.equal(nav.primary.length, MAX_PRIMARY)
  assert.deepEqual(ids(nav.groups[0].items), ['p7', 'p8', 'p9'])
  const plain = buildLayoutNav({ pages: many, groups: {}, spec: { id: 'alpha' }, activeId: '', go: () => {} })
  assert.equal(plain.primary.length, 0)
  assert.equal(plain.groups[0].items.length, 10)
})

test('go() is the host’s navigate', () => {
  const went: string[] = []
  const nav = buildLayoutNav({ pages: PAGES, groups: {}, spec: { id: 'alpha' }, activeId: '', go: (id) => void went.push(id) })
  nav.go('logs')
  assert.deepEqual(went, ['logs'])
})

const manifest = (pages: ShellPage[], layout: Record<string, unknown> = {}, site: Record<string, unknown> = {}) => ({
  pages,
  layout,
  site,
})

test('home: `/` opens the layout’s home unless the app configured a default page', () => {
  assert.equal(defaultPageId(manifest(PAGES), {}, 'welcome'), 'welcome')
  assert.equal(defaultPageId(manifest(PAGES, { defaultPage: 'logs' }), {}, 'welcome'), 'logs')
  assert.equal(defaultPageId(manifest(PAGES, {}, { defaultPage: 'tools' }), {}, 'welcome'), 'tools')
  assert.equal(defaultPageId(manifest(PAGES), {}, 'missing'), 'home', 'an unknown home falls back to the first page')
})

test('a layout-owned page is never the fallback first page', () => {
  const pages = [page('welcome', { layouts: ['alpha'] }), ...PAGES.filter((p) => p.id !== 'welcome')]
  assert.equal(defaultPageId(manifest(pages)), 'home')
})
