// The docs page footer's links and dates (pageFooterLinks.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { feedbackIssueUrl, formatUpdated } from './pageFooterLinks'

test('commit dates read as a day, a short month and a year, in UTC', () => {
    assert.equal(formatUpdated('2026-11-17'), '17 Nov 2026')
    assert.equal(formatUpdated('2026-01-02', 'en-US'), 'Jan 2, 2026')
    assert.equal(formatUpdated('yesterday'), 'yesterday')
})

test('a "No" opens a new issue that names the page', () => {
    const url = new URL(feedbackIssueUrl('https://github.com/acme/site/issues/new', 'Quick Start', 'https://docs.acme.dev/docs/quickstart'))
    assert.equal(url.origin + url.pathname, 'https://github.com/acme/site/issues/new')
    assert.equal(url.searchParams.get('title'), 'Docs: Quick Start')
    assert.match(url.searchParams.get('body')!, /^Page: https:\/\/docs\.acme\.dev\/docs\/quickstart\n/)
    // A template in the issues URL is kept.
    assert.match(feedbackIssueUrl('https://g/issues/new?template=docs.md', 'A', 'u'), /\?template=docs\.md&title=/)
})
