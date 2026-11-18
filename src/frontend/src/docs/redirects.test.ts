// The not-found view's redirect matcher (the browser copy of compiler/redirects.py) and its page suggestions.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInternal, matchRedirect, suggestPages } from './redirects'

const rules = [
    { source: '/docs/old', destination: '/docs/new' },
    { source: '/docs/v1/:slug*', destination: '/docs/:slug*' },
    { source: '/blog/:year/:post', destination: '/news/:post?y=:year' },
    { source: '/away', destination: 'https://example.com/x' },
]

test('exact sources, a final :name* (rest of the path or nothing) and :name (one segment)', () => {
    assert.equal(matchRedirect(rules, '/docs/old/'), '/docs/new')
    assert.equal(matchRedirect(rules, '/docs/older'), null)
    assert.equal(matchRedirect(rules, '/docs/v1/guide/setup'), '/docs/guide/setup')
    assert.equal(matchRedirect(rules, '/docs/v1'), '/docs')
    assert.equal(matchRedirect(rules, '/docs/v10'), null)
    assert.equal(matchRedirect(rules, '/blog/2024/hello'), '/news/hello?y=2024')
    assert.equal(matchRedirect(rules, '/blog/2024/hello/more'), null)
})

test('full URLs pass through; no rules or a broken rule match nothing', () => {
    assert.equal(matchRedirect(rules, '/away'), 'https://example.com/x')
    assert.equal(isInternal('/docs/x'), true)
    assert.equal(isInternal('//cdn.example.com'), false)
    assert.equal(isInternal('https://example.com'), false)
    assert.equal(matchRedirect(undefined, '/docs/old'), null)
    assert.equal(matchRedirect([{ source: '/x' } as never], '/x'), null)
})

const pages = [
    { title: 'Installation', path: '/docs/installation' },
    { title: 'Quick start', path: '/docs/quickstart' },
    { title: 'Theme colours', path: '/docs/guides/themes' },
    { title: 'Deploy', path: '/docs/deploy' },
]

test('suggestions: a mistyped last segment first, then shared words; at most `limit`', () => {
    assert.equal(suggestPages(pages, '/docs/instalation')[0].path, '/docs/installation')
    assert.equal(suggestPages(pages, '/docs/quickstrat')[0].path, '/docs/quickstart')
    assert.equal(suggestPages(pages, '/docs/old/themes')[0].path, '/docs/guides/themes')
    assert.ok(suggestPages(pages, '/docs/x', 2).length <= 2)
    // nothing in common, or only the words every page has
    assert.deepEqual(suggestPages(pages, '/zzz/qqq'), [])
    assert.deepEqual(suggestPages(pages, '/docs/zzz'), [])
})
