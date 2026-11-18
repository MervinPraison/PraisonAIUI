// lib/url.ts: app paths and browser URLs under a base path (aiui build --base-path).
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { basePath, normalizeBase, setBasePathForTests, stripBase, withBase } from './url'
import { resolveDocTarget } from '../docs/docSource'
import { docHrefMarkdownUrl, fetchWithRetry } from '../docs/docLoader'

afterEach(() => setBasePathForTests(undefined))

test('no meta, no base: every URL is left as it is', () => {
    assert.equal(basePath(), '')
    assert.equal(withBase('/docs/x'), '/docs/x')
    assert.equal(stripBase('/docs/x'), '/docs/x')
})

test('normalizeBase takes the forms a person types', () => {
    for (const raw of ['repo', '/repo', '/repo/', ' /repo// ']) assert.equal(normalizeBase(raw), '/repo')
    for (const raw of ['', '/', null, undefined]) assert.equal(normalizeBase(raw), '')
    assert.equal(normalizeBase('/a/b/'), '/a/b')
})

test('withBase prefixes root-absolute app paths only', () => {
    setBasePathForTests('/repo')
    assert.equal(withBase('/'), '/repo/')
    assert.equal(withBase('/docs/x.md'), '/repo/docs/x.md')
    assert.equal(withBase('/ui-config.json'), '/repo/ui-config.json')
    for (const other of ['https://x.dev/a', '//cdn.dev/a', 'rel/a', '#top', 'mailto:a@b.c', '']) {
        assert.equal(withBase(other), other)
    }
})

test('stripBase and withBase round-trip, even when the base looks like a route', () => {
    setBasePathForTests('/docs')
    assert.equal(withBase('/docs/guide'), '/docs/docs/guide')
    assert.equal(stripBase('/docs/docs/guide'), '/docs/guide')
    assert.equal(stripBase('/docs'), '/')
    assert.equal(stripBase('/docs/'), '/')
    assert.equal(stripBase('/docsx/a'), '/docsx/a')
})

test('markdown targets and card links resolve to URLs under the base', () => {
    setBasePathForTests('/repo')
    assert.equal(resolveDocTarget('/docs/a', '/docs/guide/b'), '/repo/docs/a')
    assert.equal(resolveDocTarget('c.md#s', '/docs/guide/b'), '/repo/docs/guide/c#s')
    assert.equal(resolveDocTarget('../img/x.png', '/docs/guide/b'), '/repo/docs/img/x.png')
    assert.equal(resolveDocTarget('https://x.dev', '/docs/a'), 'https://x.dev')
    assert.equal(resolveDocTarget('#top', '/docs/a'), '#top')
})

test('a link under the base prefetches the app path the loader caches', () => {
    setBasePathForTests('/repo')
    assert.equal(docHrefMarkdownUrl('/repo/docs/a', 'https://u.github.io/repo/docs/b'), '/docs/a.md')
    assert.equal(docHrefMarkdownUrl('/repo/', 'https://u.github.io/repo/docs/b'), '/docs/index.md')
})

test('fetchWithRetry requests the URL under the base', async () => {
    setBasePathForTests('/repo')
    const seen: string[] = []
    const fetchImpl = (async (url: string) => {
        seen.push(url)
        return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    await fetchWithRetry('/docs-nav.json', { fetchImpl })
    assert.deepEqual(seen, ['/repo/docs-nav.json'])
})
