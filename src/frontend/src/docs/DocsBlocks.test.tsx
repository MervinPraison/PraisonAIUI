// Docs components (DocsBlocks.tsx): card links keep the block-link allowlist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocsDiv } from './DocsBlocks'
import { cardHref } from './cardHref'

test('a card link is relative, http(s) or mailto; any other scheme is dropped', () => {
    assert.equal(cardHref('https://example.com/a'), 'https://example.com/a')
    assert.equal(cardHref('mailto:team@example.com'), 'mailto:team@example.com')
    assert.equal(cardHref('#install'), '#install')
    assert.equal(cardHref('/docs/guide/first'), '/docs/guide/first')
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x']) {
        assert.equal(cardHref(bad), undefined, bad)
    }
})

test('a card with an unsafe link renders as a plain card, not a link', () => {
    const html = renderToStaticMarkup(
        <DocsDiv itemType="aiui:card" title="Danger" value="javascript:alert(1)">body</DocsDiv>,
    )
    assert.ok(!html.includes('<a'), html)
    assert.ok(!html.includes('javascript:'), html)
    assert.match(html, /class="aiui-card"/)
})

test('a card with an external link opens it in a new tab', () => {
    const html = renderToStaticMarkup(
        <DocsDiv itemType="aiui:card" title="Site" value="https://example.com">body</DocsDiv>,
    )
    assert.match(html, /<a class="aiui-card"[^>]*href="https:\/\/example.com"/)
    assert.match(html, /rel="noopener noreferrer"/)
})
