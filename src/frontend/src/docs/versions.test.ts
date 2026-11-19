// Docs versions (versions.ts): which version a path is in, the open version's sidebar
// entries and tabs, and the switcher keeping the reader on the same page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NavDivision, NavItem } from '../types'
import { versionAt, versionItems, versionLinks, versionNavigation } from './versions'

const VERSIONS: NavDivision[] = [
    { version: 'v2', default: true, tag: 'Latest', prefix: '/docs' },
    { version: 'v1', tag: 'Deprecated', prefix: '/docs/v1', tabs: [{ tab: 'Old', groups: [{ group: 'Old' }] }] },
    { version: 'v1.5', prefix: '/docs/v1.5', hidden: true },
]

const ITEMS: NavItem[] = [
    { title: 'Home', path: '/docs/index' },
    { title: 'Quickstart', path: '/docs/quickstart' },
    { title: 'Guide', children: [{ title: 'Setup', path: '/docs/guide/setup' }] },
    { title: 'GitHub', extra: true } as unknown as NavItem,
    { title: 'Home v1', path: '/docs/v1' },
    { title: 'Quickstart v1', path: '/docs/v1/quickstart' },
    { title: 'Legacy', path: '/docs/v1/legacy' },
    { title: 'Guide', children: [{ title: 'Setup v1', path: '/docs/v1/guide/setup' }] },
]

test('versionAt: the longest prefix that holds the path, else the default; -1 with no versions', () => {
    assert.equal(versionAt(VERSIONS, '/'), 0)
    assert.equal(versionAt(VERSIONS, '/docs/quickstart'), 0)
    assert.equal(versionAt(VERSIONS, '/docs/v1'), 1)
    assert.equal(versionAt(VERSIONS, '/docs/v1/guide/setup/'), 1)
    assert.equal(versionAt(VERSIONS, '/docs/v10/x'), 0)
    assert.equal(versionAt(VERSIONS, '/docs/v1.5/x'), 2)
    assert.equal(versionAt([], '/docs/x'), -1)
    assert.equal(versionAt([{ version: 'a', prefix: '/docs' }, { version: 'b', prefix: '/docs/b' }], '/docs/x'), 0)
})

test('versionItems keeps the open version entries; a link goes with the default', () => {
    assert.deepEqual(versionItems(ITEMS, VERSIONS, 0).map((i) => i.title), ['Home', 'Quickstart', 'Guide', 'GitHub'])
    assert.deepEqual(versionItems(ITEMS, VERSIONS, 1).map((i) => i.title), ['Home v1', 'Quickstart v1', 'Legacy', 'Guide'])
    assert.equal(versionItems(ITEMS, [], -1), ITEMS)
})

test('versionNavigation: a version shows its own tabs; the default the top-level tabs and dropdowns', () => {
    const navigation = { tabs: [{ tab: 'Guides' }], dropdowns: [{ dropdown: 'Cloud' }], anchors: [{ anchor: 'Blog' }], versions: VERSIONS }
    assert.deepEqual(versionNavigation(navigation, 0)?.tabs, [{ tab: 'Guides' }])
    assert.deepEqual(versionNavigation(navigation, 1)?.tabs?.map((t) => t.tab), ['Old'])
    assert.deepEqual(versionNavigation(navigation, 1)?.dropdowns, [])
    assert.deepEqual(versionNavigation(navigation, 2)?.tabs, [])
    assert.deepEqual(versionNavigation(navigation, 1)?.anchors, [{ anchor: 'Blog' }])
    assert.equal(versionNavigation(navigation, -1), navigation)
})

test('versionLinks open the same page in the other version, else its first page; a hidden version is left out', () => {
    const path = (links: ReturnType<typeof versionLinks>) => links.map((l) => [l.name, l.page?.path, l.active])
    assert.deepEqual(path(versionLinks(VERSIONS, ITEMS, '/docs/quickstart', 0)), [
        ['v2', '/docs/quickstart', true], ['v1', '/docs/v1/quickstart', false]])
    assert.deepEqual(path(versionLinks(VERSIONS, ITEMS, '/docs/v1/guide/setup', 1)), [
        ['v2', '/docs/guide/setup', false], ['v1', '/docs/v1/guide/setup', true]])
    // Only in v1: the default version opens its first page.
    assert.equal(versionLinks(VERSIONS, ITEMS, '/docs/v1/legacy', 1)[0].page?.path, '/docs/index')
    // The docs home ('/') and a version's home match each other.
    assert.equal(versionLinks(VERSIONS, ITEMS, '/', 0)[1].page?.path, '/docs/v1')
    assert.equal(versionLinks(VERSIONS, ITEMS, '/docs/v1', 1)[0].page?.path, '/docs/index')
    assert.equal(versionLinks(VERSIONS, ITEMS, '/docs/v1', 1)[0].tag, 'Latest')
})
