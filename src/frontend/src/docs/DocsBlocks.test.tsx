// Docs components (DocsBlocks.tsx): card links keep the block-link allowlist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DOCS_TAG_COMPONENTS } from './DocsBlocks'

const Card = DOCS_TAG_COMPONENTS['aiui-card']
import { cardHref } from './cardHref'
import { Markdown } from '../markdown/Markdown'
import { preprocessMkdocsMarkdown } from '../markdown/mkdocsPreprocess'
import { DOCS_ALLOWED_ELEMENTS } from '../markdown/docsTags'

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
        <Card title="Danger" href="javascript:alert(1)">body</Card>,
    )
    assert.ok(!html.includes('<a'), html)
    assert.ok(!html.includes('javascript:'), html)
    assert.match(html, /class="aiui-card"/)
})

test('a card with an external link opens it in a new tab', () => {
    const html = renderToStaticMarkup(
        <Card title="Site" href="https://example.com">body</Card>,
    )
    assert.match(html, /<a class="aiui-card"[^>]*href="https:\/\/example.com"/)
    assert.match(html, /rel="noopener noreferrer"/)
})

test('the docs page renders every table element through its component (sanitizer included)', () => {
    const md = [
        '<Steps>', '  <Step title="Install">', '    Run it.', '  </Step>', '</Steps>',
        '<CardGroup cols={3}>', '<Card title="Go" icon="rocket" href="guide/x.md">Body</Card>', '<Card title="Bad" href="javascript:alert(1)" />', '</CardGroup>',
        '<Frame caption="Cap">', '![alt](x.png)', '</Frame>',
        '<AccordionGroup>', '<Accordion title="More">Hidden</Accordion>', '</AccordionGroup>',
    ].join('\n')
    const html = renderToStaticMarkup(
        <Markdown variant="docs" components={DOCS_TAG_COMPONENTS} allowElements={DOCS_ALLOWED_ELEMENTS}>{preprocessMkdocsMarkdown(md)}</Markdown>,
    )
    assert.match(html, /<ol class="aiui-steps">\s*<li class="aiui-step"><p class="aiui-step-title">Install<\/p><div class="aiui-step-body">\s*<p[^>]*>Run it\.<\/p>/)
    assert.match(html, /class="aiui-cards" style="--aiui-cards-cols:3"/)
    assert.match(html, /<a class="aiui-card"[^>]*href="\/docs\/guide\/x"/)
    assert.ok(!html.includes('javascript:'), html)
    assert.match(html, /<figure class="aiui-frame">[\s\S]*<figcaption>Cap<\/figcaption><\/figure>/)
    assert.match(html, /<div class="aiui-accordions">\s*<details/)
    assert.ok(!/<aiui-/.test(html), html)
})
