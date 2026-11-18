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

test('an exact source, trailing slash or not', () => {
    assert.equal(matchRedirect(rules, '/docs/old'), '/docs/new')
    assert.equal(matchRedirect(rules, '/docs/old/'), '/docs/new')
    assert.equal(matchRedirect(rules, '/docs/older'), null)
})

test('a final :name* takes the rest of the path, or nothing', () => {
    assert.equal(matchRedirect(rules, '/docs/v1/guide/setup'), '/docs/guide/setup')
    assert.equal(matchRedirect(rules, '/docs/v1'), '/docs')
    assert.equal(matchRedirect(rules, '/docs/v10'), null)
})

test(':name is one segment and fills the destination, query included', () => {
    assert.equal(matchRedirect(rules, '/blog/2024/hello'), '/news/hello?y=2024')
    assert.equal(matchRedirect(rules, '/blog/2024/hello/more'), null)
})

test('full URLs pass through; only site paths get the base', () => {
    assert.equal(matchRedirect(rules, '/away'), 'https://example.com/x')
    assert.equal(isInternal('/docs/x'), true)
    assert.equal(isInternal('//cdn.example.com'), false)
    assert.equal(isInternal('https://example.com'), false)
})

test('no rules, or a rule missing its fields, matches nothing', () => {
    assert.equal(matchRedirect(undefined, '/docs/old'), null)
    assert.equal(matchRedirect([{ source: '/x' } as never], '/x'), null)
})

const pages = [
    { title: 'Installation', path: '/docs/installation' },
    { title: 'Quick start', path: '/docs/quickstart' },
    { title: 'Theme colours', path: '/docs/guides/themes' },
    { title: 'Deploy', path: '/docs/deploy' },
]

test('a mistyped last segment suggests that page first', () => {
    assert.equal(suggestPages(pages, '/docs/instalation')[0].path, '/docs/installation')
    assert.equal(suggestPages(pages, '/docs/quickstrat')[0].path, '/docs/quickstart')
})

test('shared words in the path or title count; at most `limit` pages', () => {
    assert.equal(suggestPages(pages, '/docs/old/themes')[0].path, '/docs/guides/themes')
    assert.ok(suggestPages(pages, '/docs/x', 2).length <= 2)
})

test('nothing in common, or only the words every page has: no suggestions', () => {
    assert.deepEqual(suggestPages(pages, '/zzz/qqq'), [])
    assert.deepEqual(suggestPages(pages, '/docs/zzz'), [])
})
