// The split search index (searchShards.ts) against the whole one: the same
// ranking for every query, only the parts a query needs fetched, and a
// fallback to search-index.json. search-shards.fixture.json is the Python
// writer's output (tests/unit/test_search_shards.py keeps it current).
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resetSearchIndexCache, searchDocs, type SearchIndex } from './searchIndex'
import { queryTerms } from './searchRank'
import { decodePostings, openSearchIndex, resetOpenedIndex, ShardedIndex, type ShardMeta } from './searchShards'
import type { SearchGroup } from '../types'

const fixture = JSON.parse(readFileSync(path.resolve(process.cwd(), 'src/docs/search-shards.fixture.json'), 'utf8')) as {
    full: SearchIndex
    files: Record<string, unknown>
}
const meta = fixture.files['meta.json'] as ShardMeta
const groups: SearchGroup[] = [
    { title: 'Get started', tab: 'Guides', pages: fixture.full.pages.slice(0, 4).map((p) => ({ title: p.t, path: p.p, description: p.d })) },
    { title: 'More', tab: 'Reference', boost: 1.5, pages: fixture.full.pages.slice(4).map((p) => ({ title: p.t, path: p.p, description: p.d })) },
]

/** A fetch for the fixture's files under /site/search-index/; anything else 404s. Records the URLs asked for. */
function server(files = fixture.files) {
    const asked: string[] = []
    const get = async (url: string) => {
        asked.push(url)
        if (url === '/site/search-index.json') return fixture.full
        const name = url.replace('/site/search-index/', '')
        if (!(name in files)) throw new Error('HTTP 404')
        return structuredClone(files[name])
    }
    return { get, asked }
}

const sharded = (get: (url: string) => Promise<unknown>) => new ShardedIndex(meta, `/site/search-index/${meta.key}/`, '/site/search-index.json', get)

async function rank(index: ShardedIndex, query: string, tab?: string) {
    await index.need(queryTerms(query))
    const first = searchDocs(index, groups, query, { tab })
    await index.needText(first.map((r) => r.page.path ?? ''))
    return searchDocs(index, groups, query, { tab })
}

afterEach(() => {
    resetOpenedIndex()
    resetSearchIndexCache()
})

const QUERIES = [
    'install', 'instal', 'installation', 'xnstall', 'pip install aiui', 'in', 'a', 'the',
    'theme', 'themes', 'dark mode', 'night', 'contrast', 'model fallback', 'voice', 'tts',
    'quick start', 'cli', 'build', 'serve docs', 'café', 'cafe', 'ecole', 'école', 'naïve',
    'தமிழ்', '東京', 'straße', '2026', 'how do i install', 'nothing matches zzzz',
]

test('every query ranks exactly as over search-index.json: kinds, pages, anchors, snippets, scores', async () => {
    const index = sharded(server().get)
    for (const query of QUERIES) {
        for (const tab of [undefined, 'Guides']) {
            const want = searchDocs(fixture.full, groups, query, { tab })
            const got = await rank(index, query, tab)
            const view = (r: typeof want) => r.map((x) => [x.kind, x.page.path, x.anchor, x.heading, x.snippet, x.score])
            assert.deepEqual(view(got), view(want), `${query} (${tab ?? 'all'})`)
        }
    }
})

test('a query fetches only the word files its words fall in, and the text of the pages it lists', async () => {
    const { get, asked } = server()
    const index = sharded(get)
    assert.equal(index.ready(['install']), false)
    assert.equal(searchDocs(index, groups, 'install').every((r) => r.kind === 'page'), true) // titles only until then
    assert.equal(await index.need(['install']), true)
    const words = asked.filter((u) => /\/w\d+\.json$/.test(u))
    assert.ok(words.length >= 1 && words.length < meta.shards.length, `${words.length} of ${meta.shards.length}`)
    assert.equal(await index.need(['install']), false) // nothing new: no second fetch, no re-render
    assert.equal(asked.filter((u) => /\/w\d+\.json$/.test(u)).length, words.length)
    const results = searchDocs(index, groups, 'install')
    assert.ok(results.some((r) => r.kind !== 'page'))
    await index.needText(results.map((r) => r.page.path ?? ''))
    const texts = asked.filter((u) => /\/p\d+\.json$/.test(u))
    assert.equal(texts.length, new Set(results.map((r) => r.page.path)).size)
    assert.ok(texts.length < meta.pages.length)
})

test('a missing part (a newer deploy) falls back to search-index.json and still ranks the same', async () => {
    const files = { ...fixture.files }
    for (const name of Object.keys(files)) if (/\/w\d+\.json$/.test(name)) delete files[name]
    const { get, asked } = server(files)
    const index = sharded(get)
    assert.equal(await index.need(['theme']), true)
    assert.ok(asked.includes('/site/search-index.json'))
    assert.equal(index.ready(['anything']), true)
    const view = (q: string, i: SearchIndex) => searchDocs(i, groups, q).map((x) => [x.kind, x.page.path, x.anchor, x.snippet, x.score])
    assert.deepEqual(view('theme', index), view('theme', fixture.full))
})

test('openSearchIndex: the split index when the site has one, else the whole file, else null', async () => {
    const { get, asked } = server()
    assert.ok((await openSearchIndex('/site/search-index.json', get)) instanceof ShardedIndex)
    assert.deepEqual(asked, ['/site/search-index/meta.json'])
    resetOpenedIndex()

    // An older build: no meta.json. The whole file comes from loadSearchIndex (global fetch).
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify(fixture.full))) as typeof fetch
    try {
        const old = await openSearchIndex('/site/search-index.json', async () => { throw new Error('HTTP 404') })
        assert.ok(old && !(old instanceof ShardedIndex) && old.pages.length === fixture.full.pages.length)
        resetOpenedIndex()
        resetSearchIndexCache()
        globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch
        assert.equal(await openSearchIndex('/site/search-index.json', async () => ({ version: 1 })), null)
    } finally {
        globalThis.fetch = realFetch
    }
})

test('postings decode gaps and counts in base 36', () => {
    assert.deepEqual([...decodePostings('0:2,1,z,1:a')], [[0, 2], [1, 1], [36, 1], [37, 10]])
})
