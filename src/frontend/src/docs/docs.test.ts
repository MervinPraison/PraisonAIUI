// Docs style helpers: page source fixes (docSource.ts) and reading order (docNav.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docSourcePath, pageRoute, prepareDocSource, resolveDocTarget, resolveDocUrls, stripFrontmatter, docPathAliases } from './docSource'
import { docNeighbours, docPages, docSearchGroups, docSection } from './docNav'
import { scoreDocMatch } from './searchRank'
import { detectActiveTabIndex, filterNavByTab, navItemTabGroupIndex } from './navTabs'
import type { DocsNav } from '../types'

test('frontmatter is metadata, never page text', () => {
    assert.equal(stripFrontmatter('---\ntitle: A\ndescription: B\n---\n# A\n'), '# A\n')
    assert.equal(stripFrontmatter('\uFEFF---\r\ntitle: A\r\n---\r\nbody'), 'body')
    // A thematic break later in the page is not frontmatter.
    assert.equal(stripFrontmatter('# A\n\n---\n\ntext'), '# A\n\n---\n\ntext')
    assert.equal(stripFrontmatter('no frontmatter'), 'no frontmatter')
})

test('relative targets resolve against the page folder and drop .md', () => {
    const page = '/docs/getting-started/style-guide'
    assert.equal(resolveDocTarget('quickstart.md', page), '/docs/getting-started/quickstart')
    assert.equal(resolveDocTarget('./cli.md#flags', page), '/docs/getting-started/cli#flags')
    assert.equal(resolveDocTarget('../concepts/configuration.md', page), '/docs/concepts/configuration')
    assert.equal(resolveDocTarget('../images/chat.png', page), '/docs/images/chat.png')
    for (const kept of ['/docs/x', '#anchor', 'https://example.com/a.md', 'mailto:a@b.c', '//cdn.example/x.png']) {
        assert.equal(resolveDocTarget(kept, page), kept)
    }
})

test('links and images are rewritten outside code only', () => {
    const page = '/docs/a/b'
    const md = [
        'See [c](c.md "C") and ![img](../img/x.png).',
        '[ref]: ./d.md',
        'Inline `[not](e.md)` stays.',
        '```md',
        '[kept](f.md)',
        '```',
        '[after](g.md)',
    ].join('\n')
    assert.equal(
        resolveDocUrls(md, page),
        [
            'See [c](/docs/a/c "C") and ![img](/docs/img/x.png).',
            '[ref]: /docs/a/d',
            'Inline `[not](e.md)` stays.',
            '```md',
            '[kept](f.md)',
            '```',
            '[after](/docs/a/g)',
        ].join('\n'),
    )
    assert.equal(prepareDocSource('---\nt: 1\n---\n[x](y.md)', page), '[x](/docs/a/y)')
})

const NAV: DocsNav = {
    items: [
        { title: 'Home', path: '/docs/index' },
        {
            title: 'Guides',
            children: [
                { title: 'One', path: '/docs/guides/one' },
                { title: 'Two', path: '/docs/guides/two/' },
            ],
        },
        { title: 'Last', path: '/docs/last' },
    ],
}

test('pages follow sidebar order and neighbours cross groups', () => {
    assert.deepEqual(docPages(NAV).map((p) => p.title), ['Home', 'One', 'Two', 'Last'])
    const mid = docNeighbours(NAV, '/docs/guides/two')
    assert.equal(mid.prev?.title, 'One')
    assert.equal(mid.next?.title, 'Last')
    assert.equal(docNeighbours(NAV, '/docs/index').prev, null)
    assert.equal(docNeighbours(NAV, '/docs/last').next, null)
    assert.deepEqual(docNeighbours(NAV, '/docs/missing'), { prev: null, next: null })
})

test('search groups put top-level pages first', () => {
    assert.deepEqual(
        docSearchGroups(NAV).map((g) => [g.title, g.pages.map((p) => p.title)]),
        [['Pages', ['Home', 'Last']], ['Guides', ['One', 'Two']]],
    )
})

test('the section is the closest group title', () => {
    assert.equal(docSection(NAV, '/docs/guides/one'), 'Guides')
    assert.equal(docSection(NAV, '/docs/index'), null)
    assert.equal(docSection(NAV, '/docs/missing'), null)
})

test('search ranks title matches above section matches', () => {
    const theme = scoreDocMatch('Theme System', 'Features', 'them')
    const word = scoreDocMatch('Dark theme', 'Features', 'them')
    const inside = scoreDocMatch('Anthem', 'Features', 'them')
    const section = scoreDocMatch('Colours', 'Theming', 'them')
    assert.ok(theme > word && word > inside && inside > section && section > 0)
    assert.equal(scoreDocMatch('ADR 0002: One React app shell', 'Adr', 'them'), 0)
    assert.ok(scoreDocMatch('Deploy to GitHub Pages', 'Getting Started', 'deploy pages') > 0)
    assert.equal(scoreDocMatch('Deploy', 'Guides', 'deploy pages'), 0)
    assert.equal(scoreDocMatch('Anything', 'Any', '  '), 1)
})

test('a tab lists its sidebar groups in the order the YAML gives them', () => {
    const items: NonNullable<DocsNav['items']> = [
        { title: 'Concepts', path: '/docs/concepts', children: [{ title: 'A', path: '/docs/concepts/a' }] },
        { title: 'Getting Started', path: '/docs/getting-started', children: [{ title: 'B', path: '/docs/getting-started/b' }] },
        { title: 'Home', path: '/docs/index' },
        { title: 'Api', path: '/docs/api', children: [{ title: 'C', path: '/docs/api/c' }] },
    ]
    const tab = {
        tab: 'Docs',
        groups: [
            { group: 'Getting Started', prefix: 'getting-started', pages: ['index', 'getting-started/b'] },
            { group: 'Core Concepts', prefix: 'concepts', pages: ['concepts/a'] },
        ],
    }
    assert.deepEqual(filterNavByTab(items, tab).map((i) => i.title), ['Getting Started', 'Home', 'Concepts'])
    assert.equal(navItemTabGroupIndex(items[3], tab), -1)
    assert.equal(filterNavByTab(items, undefined), items)
})

test('page links name routes the way aiui build names pages', () => {
    const page = '/docs/adr/index'
    assert.equal(resolveDocTarget('0003-selectable-layouts.md', page), '/docs/adr/selectable-layouts')
    assert.equal(resolveDocTarget('../typescript/index.md', page), '/docs/typescript')
    assert.equal(resolveDocTarget('../protocols/adp/README.md#scope', page), '/docs/protocols/adp#scope')
    assert.equal(resolveDocTarget('../reports/ui-reset-2026-11.md', page), '/docs/reports/ui-reset-2026-11')
    // Not a page: kept as is.
    assert.equal(resolveDocTarget('../images/01-chat.png', page), '/docs/images/01-chat.png')
    assert.equal(pageRoute('/docs/02-guides/01-intro.md'), '/docs/guides/intro')
})

test('the site root shows the docs home page', () => {
    assert.equal(docSourcePath('/', '/docs/index'), '/docs/index')
    assert.equal(docSourcePath('/', null), null)
    assert.equal(docSourcePath('/docs/a/b/', '/docs/index'), '/docs/a/b')
})

test('a URL that names a page another way maps to its route', () => {
    assert.deepEqual(docPathAliases('/getting-started/quickstart'), ['/docs/getting-started/quickstart'])
    assert.deepEqual(docPathAliases('/docs/adr/0003-selectable-layouts'), ['/docs/adr/selectable-layouts'])
    assert.deepEqual(docPathAliases('/docs/typescript/index/'), ['/docs/typescript'])
    assert.deepEqual(docPathAliases('/adr/0001-x'), ['/adr/x', '/docs/adr/0001-x', '/docs/adr/x'])
    assert.deepEqual(docPathAliases('/docs/getting-started/quickstart'), [])
    assert.deepEqual(docPathAliases('/'), [])
})

test('the active tab is the one whose groups list the page, before folder prefixes', () => {
    const tabs = [
        { tab: 'Guides', groups: [{ group: 'Guides', prefix: 'features', pages: ['features/layouts'] }] },
        { tab: 'Reference', groups: [{ group: 'Reference', pages: ['api/cli', 'features/protocols'] }] },
    ]
    assert.equal(detectActiveTabIndex(tabs, '/docs/features/protocols'), 1)
    assert.equal(detectActiveTabIndex(tabs, '/docs/api/cli/'), 1)
    assert.equal(detectActiveTabIndex(tabs, '/docs/features/layouts'), 0)
    // Not listed: the folder prefix decides, then the first tab.
    assert.equal(detectActiveTabIndex(tabs, '/docs/features/other'), 0)
    assert.equal(detectActiveTabIndex(tabs, '/'), 0)
})

test('manual nav sections (no path) group pages and name the section', () => {
    const nav: DocsNav = {
        items: [
            { title: 'Guides', children: [{ title: 'Layouts', children: [{ title: 'Overview', path: '/docs/features/layouts' }] }] },
            { title: 'Hidden', path: '/docs/notes' },
        ],
    }
    assert.deepEqual(docPages(nav).map((p) => p.path), ['/docs/features/layouts', '/docs/notes'])
    assert.equal(docSection(nav, '/docs/features/layouts'), 'Layouts')
    const tab = { tab: 'Guides', groups: [{ group: 'Guides', pages: ['features/layouts'] }] }
    assert.deepEqual(filterNavByTab(nav.items ?? [], tab).map((i) => i.title), ['Guides'])
})
