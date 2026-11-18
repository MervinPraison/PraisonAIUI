import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeTags, pageUrl, robotsContent } from './seoMeta'
import { docNeighbours, docSearchGroups, navItemShown } from './docNav'
import type { DocsNav } from '../types'

test('one robots value: noindex keeps links followed; the site switch wins', () => {
    assert.equal(robotsContent(false, undefined), 'index, follow')
    assert.equal(robotsContent(true, undefined), 'noindex')
    assert.equal(robotsContent(true, { follow: false }), 'noindex, nofollow')
    assert.equal(robotsContent(false, { index: false }), 'noindex')
    assert.equal(robotsContent(false, { follow: false }), 'index, nofollow')
})

test('trailingSlash puts a slash on the canonical URL', () => {
    assert.equal(pageUrl('https://ex.com', '/docs/a', undefined), 'https://ex.com/docs/a')
    assert.equal(pageUrl('https://ex.com', '/docs/a', { trailingSlash: true }), 'https://ex.com/docs/a/')
    assert.equal(pageUrl('https://ex.com', '/', { trailingSlash: true }), 'https://ex.com/')
})

test('hidden pages leave the sidebar and pager; noindex pages leave search', () => {
    const nav: DocsNav = {
        items: [
            { title: 'A', path: '/docs/a' },
            { title: 'Beta', path: '/docs/beta', hidden: true, noindex: true },
            { title: 'Old', path: '/docs/old', noindex: true },
            { title: 'Lab', children: [{ title: 'X', path: '/docs/x', hidden: true }] },
            { title: 'All', path: '/docs/all', hidden: true }, // seo.indexing: all
        ],
    }
    assert.deepEqual((nav.items ?? []).map(navItemShown), [true, false, true, false, false])
    assert.equal(docNeighbours(nav, '/docs/a').next?.title, 'Old')
    assert.deepEqual(docSearchGroups(nav)[0].pages.map((p) => p.title), ['A', 'All'])
})

test('page tags: overrides win, og:url follows the canonical, a large card with an image, noindex stays', () => {
    const abs = (p: string) => `https://ex.com${p}`
    const defaults = { canonical: 'https://ex.com/docs/a', robots: 'index, follow', 'og:title': 'A' }
    assert.deepEqual(mergeTags(defaults, {}, abs), { ...defaults, 'og:url': 'https://ex.com/docs/a', 'twitter:card': 'summary' })
    const tags = mergeTags(defaults, { canonical: '/docs/b', 'og:image': '/x.png', robots: 'noindex' }, abs)
    assert.equal(tags['og:url'], 'https://ex.com/docs/b')
    assert.equal(tags['twitter:image'], 'https://ex.com/x.png')
    assert.equal(tags['twitter:card'], 'summary_large_image')
    assert.equal(tags.robots, 'noindex')
    assert.equal(mergeTags({ ...defaults, robots: 'noindex' }, { robots: 'index, follow' }, abs).robots, 'noindex')
    assert.equal(mergeTags(defaults, { 'og:image': '/x.png', 'twitter:card': 'summary' }, abs)['twitter:card'], 'summary')
})
