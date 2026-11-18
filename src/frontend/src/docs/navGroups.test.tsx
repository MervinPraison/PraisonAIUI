// Sidebar groups (Sidebar.tsx NavTree, docNav.ts): a group's own page, folding, drilldown and the breadcrumb trail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { NavTree } from '../Sidebar'
import { docPages, docSection, docTrail, navItemHolds, rememberedOpen, rememberOpen } from './docNav'
import type { DocsNav } from '../types'

const NAV: DocsNav = {
    items: [
        { title: 'Home', path: '/docs/index' },
        { title: 'API', path: '/docs/api/overview', tag: 'New', children: [
            { title: 'Auth', path: '/docs/api/auth' },
            { title: 'More', expanded: false, children: [{ title: 'Errors', path: '/docs/api/errors' }] },
        ] },
        { title: 'Guides', children: [{ title: 'First', path: '/docs/guide/first' }] },
    ],
}

const render = (nav: DocsNav, active = '/docs/index') =>
    renderToStaticMarkup(<NavTree nav={nav} activeItem={active} onItemClick={() => {}} />)

test('a group root page is read before the group pages and anchors the trail', () => {
    assert.deepEqual(docPages(NAV).map((p) => p.title), ['Home', 'API', 'Auth', 'Errors', 'First'])
    assert.deepEqual(docTrail(NAV, '/docs/api/errors').map((c) => c.title), ['API', 'More'])
    assert.deepEqual(docTrail(NAV, '/docs/api/overview'), [])
    assert.equal(docSection(NAV, '/docs/api/errors'), 'More')
    assert.ok(navItemHolds(NAV.items![1], '/docs/api/errors'))
    assert.ok(!navItemHolds(NAV.items![2], '/docs/api/errors'))
})

test('groups fold: expanded false starts shut, the active page opens its group', () => {
    const html = render(NAV)
    // API links to its own page, with a separate fold button and its tag.
    assert.match(html, /<a href="\/docs\/api\/overview"[^>]*>.*API.*New/)
    assert.match(html, /aria-label="Collapse API"/)
    // More (expanded: false) is shut; Guides (no page, no drilldown) is a toggle button.
    assert.match(html, /<button type="button" aria-expanded="false"[^>]*>.*More/)
    assert.match(html, /<div id="[^"]+" class="aiui-docs-group-items" hidden="">.*Errors/)
    assert.match(render(NAV, '/docs/api/errors'), /aria-expanded="true"[^>]*>.*More/)
})

test('drilldown makes a group label open its first page; collapsible false drops the toggles', () => {
    assert.match(render({ ...NAV, drilldown: true }), /<a href="\/docs\/guide\/first"[^>]*>.*Guides/)
    const flat = render({ ...NAV, collapsible: false })
    assert.doesNotMatch(flat, /aria-expanded|hidden=""/)
})

test('a reader fold is remembered (in memory when storage is missing)', () => {
    assert.equal(rememberedOpen('API'), undefined)
    rememberOpen('API', false)
    assert.equal(rememberedOpen('API'), false)
    assert.match(render(NAV), /aria-label="Expand API"/)
})
