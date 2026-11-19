// "Related pages" links (related.ts): titles from the nav, labels, anchors, external links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DocsNav } from '../types'
import { relatedLinks } from './related'

const nav: DocsNav = {
    items: [
        { title: 'Deploy', path: '', children: [
            { title: 'Docker', pageTitle: 'Deploy with Docker', path: '/docs/deploy/docker' },
            { title: 'Server', path: '/docs/deploy/server', hidden: true },
        ] },
    ],
}
const href = (path: string) => `/base${path}`

test('page paths take their title from the nav; labels, anchors and external links kept', () => {
    const item = { title: 'X', path: '/docs/x', related: [
        '/docs/deploy/docker',
        '/docs/deploy/server#nginx',
        { title: 'Guide', path: '/docs/deploy/docker' },
        { title: 'Elsewhere', href: 'https://example.com/a' },
    ] }
    assert.deepEqual(relatedLinks(nav, item, href), [
        { title: 'Deploy with Docker', href: '/base/docs/deploy/docker' },
        { title: 'Server', href: '/base/docs/deploy/server#nginx' },
        { title: 'Guide', href: '/base/docs/deploy/docker' },
        { title: 'Elsewhere', href: 'https://example.com/a', external: true },
    ])
})

test('paths the nav lacks and links that are not http(s) are dropped', () => {
    const item = { title: 'X', related: ['/docs/gone', { title: 'Bad', href: 'javascript:alert(1)' }] }
    assert.deepEqual(relatedLinks(nav, item, href), [])
    assert.deepEqual(relatedLinks(nav, { title: 'X' }, href), [])
})
