// Tabs, tab menus, anchors and dropdowns (navDivisions.ts, DivisionNav.tsx): which sidebar each opens and how they draw.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { HeaderTabs, SidebarDivisions } from './DivisionNav'
import { activeSection, divisionLinks, inDivision, navSections, type NavDivisions } from './navDivisions'
import { detectActiveTabIndex, filterNavByTab } from './navTabs'
import type { NavigationConfig, NavItem } from '../types'

const ITEMS: NavItem[] = [
    { title: 'Guides', children: [{ title: 'Start', path: '/docs/guides/start' }] },
    { title: 'REST', children: [{ title: 'Users', path: '/docs/rest/users' }] },
    { title: 'SDK', children: [{ title: 'Python', path: '/docs/sdk/python' }] },
    { title: 'Blog', children: [{ title: 'Launch', path: '/docs/blog/launch' }] },
    { title: 'Cloud', children: [{ title: 'Deploy', path: '/docs/cloud/deploy' }] },
]

const NAVIGATION: NavigationConfig = {
    tabs: [
        { tab: 'Guides', icon: 'book', groups: [{ group: 'Guides' }] },
        { tab: 'API', menu: [
            { item: 'REST', description: 'HTTP endpoints', groups: [{ group: 'REST' }] },
            { item: 'SDK', groups: [{ group: 'SDK' }] },
            { item: 'Status', href: 'https://status.example.com' },
        ] },
        { tab: 'GitHub', url: 'https://github.com/example' },
    ],
    anchors: [
        { anchor: 'Community', icon: 'users', href: 'https://example.com/chat' },
        { anchor: 'Blog', groups: [{ group: '', pages: ['blog/launch'] }] },
    ],
    dropdowns: [{ dropdown: 'Cloud', description: 'Hosted', tabs: [{ tab: 'Deploy', groups: [{ group: 'Cloud' }] }] }],
}

test('every division with groups is a section with its own sidebar, keyed by where it sits', () => {
    const sections = navSections(NAVIGATION)
    assert.deepEqual(sections.map((s) => [s.key, s.tab]), [['t0', 'Guides'], ['t1.0', 'REST'], ['t1.1', 'SDK'], ['a1', 'Blog'], ['d0.0', 'Deploy']])
    assert.deepEqual(filterNavByTab(ITEMS, sections[2]).map((i) => i.title), ['SDK'])
    // A division's loose pages (an untitled group) claim their section.
    assert.deepEqual(filterNavByTab(ITEMS, sections[3]).map((i) => i.title), ['Blog'])
    assert.equal(detectActiveTabIndex(sections, '/docs/blog/launch'), 3)
    // Groups named only by title: the section whose sidebar holds the page; a picked one wins while it holds it.
    assert.equal(activeSection(ITEMS, sections, '/docs/sdk/python'), 2)
    assert.equal(activeSection(ITEMS, [...sections, { tab: 'Again', key: 'a9', groups: [{ group: 'SDK' }] }], '/docs/sdk/python', 5), 5)
    assert.equal(activeSection(ITEMS, sections, '/docs/sdk/python', 0), 2)
    assert.ok(inDivision('t1.0', 't1') && !inDivision('t10', 't1') && !inDivision('t1', 't1.0'))
})

test('a tab opens its first page, a menu tab its first item, an href tab links out', () => {
    const sections = navSections(NAVIGATION)
    const { tabs, anchors, dropdowns } = divisionLinks(NAVIGATION, ITEMS, sections, 't1.1')
    assert.equal(tabs[0].page?.path, '/docs/guides/start')
    assert.equal(tabs[1].active, true)
    assert.equal(tabs[1].page?.path, '/docs/rest/users')
    assert.equal(tabs[1].menu?.[1].active, true)
    assert.equal(tabs[1].menu?.[2].href, 'https://status.example.com')
    assert.equal(tabs[2].href, 'https://github.com/example')
    assert.equal(anchors[1].page?.path, '/docs/blog/launch')
    assert.equal(anchors[1].section, 3)
    // A dropdown's own tabs join the header only while it is open.
    assert.equal(tabs.length, 3)
    assert.equal(dropdowns[0].page?.path, '/docs/cloud/deploy')
    const open = divisionLinks(NAVIGATION, ITEMS, sections, 'd0.0')
    assert.deepEqual(open.tabs.map((t) => t.name), ['Guides', 'API', 'GitHub', 'Deploy'])
    assert.equal(open.dropdowns[0].active, true)
})

const model = (key: string): NavDivisions => ({ ...divisionLinks(NAVIGATION, ITEMS, navSections(NAVIGATION), key), open: () => {} })

test('header tabs are links, a menu tab a menu button, the active one marked', () => {
    const html = renderToStaticMarkup(<HeaderTabs divisions={model('t0')} />)
    assert.match(html, /<a class="aiui-docs-tab" href="\/docs\/guides\/start" data-active="" aria-current="true">/)
    assert.match(html, /<button type="button" class="aiui-docs-tab" aria-haspopup="menu"[^>]*>.*API/)
    assert.match(html, /class="aiui-docs-tab" href="https:\/\/github.com\/example" target="_blank" rel="noopener noreferrer"/)
    assert.match(html, /\(opens in a new tab\)/)
})

test('the sidebar shows the switcher and the anchors; the drawer adds the tabs and the open tab menu', () => {
    const side = renderToStaticMarkup(<SidebarDivisions divisions={model('t1.0')} />)
    assert.match(side, /class="aiui-docs-switcher" data-active="" aria-haspopup="menu"[^>]*>.*Cloud.*Hosted/)
    assert.match(side, /<nav class="aiui-docs-anchors" aria-label="Anchors">.*Community.*Blog/)
    assert.doesNotMatch(side, /aiui-docs-drawer-tabs/)
    const drawer = renderToStaticMarkup(<SidebarDivisions divisions={model('t1.0')} drawer />)
    assert.match(drawer, /aria-label="Documentation sections">.*Guides.*API.*GitHub/)
    assert.match(drawer, /aria-label="Section menu">.*REST.*SDK.*Status/)
    // Nothing to show: no wrapper.
    const bare = { tabs: [], anchors: [], dropdowns: [], open: () => {} }
    assert.equal(renderToStaticMarkup(<SidebarDivisions divisions={bare} />), '')
})
