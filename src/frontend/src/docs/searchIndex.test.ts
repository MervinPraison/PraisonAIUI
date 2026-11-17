// Full-text docs search (searchIndex.ts): ranking, snippets, highlighting, loading.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { highlightRuns, loadSearchIndex, resetSearchIndexCache, searchDocs, snippetAround, type SearchIndex } from './searchIndex'
import type { NavItem } from '../types'

const install: NavItem = { title: 'Installation', path: '/docs/getting-started/installation', description: 'Install the package.' }
const theming: NavItem = { title: 'Theming', path: '/docs/features/theming' }
const groups = [
    { title: 'Get started', pages: [install] },
    { title: 'Theming', pages: [theming] },
]
const index: SearchIndex = {
    version: 1,
    pages: [
        { p: '/docs/getting-started/installation', t: 'Installation', s: [
            { h: '', a: '', l: 1, x: 'PraisonAIUI is one Python package.' },
            { h: 'Code blocks in chat', a: 'code-blocks-in-chat', l: 2, x: 'Fenced code shows a copy button.' },
        ] },
        { p: '/docs/features/theming', t: 'Theming', s: [
            { h: 'The Paper preset', a: 'the-paper-preset', l: 3, x: 'Serif titles and a navy accent. A code block uses JetBrains Mono.' },
        ] },
        { p: '/docs/not-in-nav', t: 'Hidden', s: [{ h: 'Code block', a: 'code-block', l: 2, x: '' }] },
    ],
}

test('a heading match opens its section; text matches follow; titles rank first', () => {
    const r = searchDocs(index, groups, 'code block')
    assert.deepEqual(r.map((x) => [x.kind, x.page.title, x.anchor]), [
        ['section', 'Installation', 'code-blocks-in-chat'],
        ['text', 'Theming', 'the-paper-preset'],
    ])
    assert.equal(searchDocs(index, groups, 'install')[0].kind, 'page')
    assert.equal(searchDocs(index, groups, 'install')[0].snippet, 'Install the package.')
})

test('every word must match; pages outside the nav are never offered', () => {
    assert.deepEqual(searchDocs(index, groups, 'navy nothing'), [])
    assert.ok(searchDocs(index, groups, 'code').every((x) => x.page.path !== '/docs/not-in-nav'))
    assert.deepEqual(searchDocs(index, groups, '   '), [])
})

test('without an index, search still finds titles', () => {
    assert.deepEqual(searchDocs(null, groups, 'them').map((x) => x.page.title), ['Theming'])
})

test('a page title match hides its own intro text match', () => {
    const r = searchDocs(index, groups, 'installation')
    assert.equal(r.filter((x) => x.page === install).length, 1)
})

test('snippets centre on the first match and cut at word edges', () => {
    const text = 'alpha '.repeat(40) + 'needle in the haystack ' + 'omega '.repeat(40)
    const s = snippetAround(text, 'needle', 60)
    assert.ok(s.startsWith('… ') && s.endsWith(' …'), s)
    assert.ok(s.includes('needle'))
    assert.equal(snippetAround('short', 'x'), 'short')
})

test('highlight runs mark every word, any case, and escape regex characters', () => {
    assert.deepEqual(highlightRuns('Set the Theme, then theme it', 'theme'), [
        { text: 'Set the ', hit: false },
        { text: 'Theme', hit: true },
        { text: ', then ', hit: false },
        { text: 'theme', hit: true },
        { text: ' it', hit: false },
    ])
    assert.deepEqual(highlightRuns('a (b) c', '(b)'), [
        { text: 'a ', hit: false },
        { text: '(b)', hit: true },
        { text: ' c', hit: false },
    ])
})

test('the index is fetched once; a missing index means title search only', async () => {
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
        calls += 1
        return new Response('not found', { status: 404 })
    }) as typeof fetch
    try {
        resetSearchIndexCache()
        assert.equal(await loadSearchIndex(), null)
        assert.equal(await loadSearchIndex(), null)
        assert.equal(calls, 1)
    } finally {
        globalThis.fetch = realFetch
        resetSearchIndexCache()
    }
})

test('a network failure is retried on the next open', async () => {
    const realFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
        calls += 1
        if (calls === 1) throw new TypeError('offline')
        return new Response(JSON.stringify(index), { status: 200 })
    }) as typeof fetch
    try {
        resetSearchIndexCache()
        assert.equal(await loadSearchIndex(), null)
        assert.equal((await loadSearchIndex())?.pages.length, 3)
        assert.equal(calls, 2)
    } finally {
        globalThis.fetch = realFetch
        resetSearchIndexCache()
    }
})
