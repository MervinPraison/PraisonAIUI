// navMatch.ts: a wrong-case URL finds its page; an ambiguous one finds none.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findNavItemIgnoringCase } from './navMatch'
import type { NavItem } from '../types'

const items: NavItem[] = [
    { title: 'Home', path: '/docs/index' },
    { title: 'API', children: [{ title: 'Sessions', path: '/docs/api/sessions' }, { title: 'Health', path: '/docs/api/health/' }] },
]

test('a wrong-case URL finds the page it names', () => {
    assert.equal(findNavItemIgnoringCase(items, '/docs/API/sessions')?.path, '/docs/api/sessions')
    assert.equal(findNavItemIgnoringCase(items, '/DOCS/api/Health')?.path, '/docs/api/health/')
    assert.equal(findNavItemIgnoringCase(items, '/docs/api/sessions/')?.path, '/docs/api/sessions')
})

test('no page, or two pages that differ by case alone: no match', () => {
    assert.equal(findNavItemIgnoringCase(items, '/docs/api/nope'), null)
    assert.equal(findNavItemIgnoringCase(undefined, '/docs/api/sessions'), null)
    const twins: NavItem[] = [{ title: 'a', path: '/docs/Readme' }, { title: 'b', path: '/docs/readme' }]
    assert.equal(findNavItemIgnoringCase(twins, '/docs/README'), null)
})
