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

const renderDocs = (md: string) => renderToStaticMarkup(
    <Markdown variant="docs" components={DOCS_TAG_COMPONENTS} allowElements={DOCS_ALLOWED_ELEMENTS}>{preprocessMkdocsMarkdown(md)}</Markdown>,
)

test('Columns lay any content out in the card grid; each Column is a plain cell', () => {
    const html = renderDocs(['<Columns cols={3}>', '<Column>', '**One**', '</Column>', '<Column>', 'Two', '</Column>', '</Columns>'].join('\n'))
    assert.match(html, /<div class="aiui-cards" style="--aiui-cards-cols:3">\s*<div class="aiui-column">\s*<p[^>]*><span[^>]*data-streamdown="strong">One<\/span>/)
    assert.equal(html.match(/class="aiui-column"/g)?.length, 2)
})

test('card options: horizontal, img, cta, arrow, color; a bad colour or image is dropped', () => {
    const html = renderDocs([
        '<Card title="Wide" icon="rocket" horizontal href="https://example.com" color="#0f766e" cta="Read more">Body</Card>',
        '<Card title="Pic" img="images/a.png" arrow={false} href="guide/x.md" />',
        '<Card title="Bad" img="javascript:alert(1)" color="red;background:url(x)" arrow href="guide/x.md" />',
    ].join('\n'))
    assert.match(html, /<a class="aiui-card" data-horizontal="" style="--aiui-card-accent:#0f766e"/)
    assert.match(html, /class="aiui-card-cta">Read more<svg/)
    assert.match(html, /class="aiui-card-arrow"[\s\S]*?M7 7h10v10/) // external: arrow up-right by default
    assert.match(html, /<a class="aiui-card" data-img=""[^>]*><img class="aiui-card-img" src="\/docs\/[^"]*images\/a.png"/)
    const bad = html.slice(html.indexOf('Bad') - 300)
    assert.ok(!html.includes('javascript:') && !html.includes('url(x)'), html)
    assert.match(bad, /aiui-card-arrow/) // arrow on an internal link when asked
    assert.equal(html.match(/aiui-card-arrow/g)?.length, 2)
})

test('steps: titleSize makes headings with ids, stepNumber restarts the count, icon replaces the number', () => {
    const html = renderDocs([
        '<Steps titleSize="h3">',
        '<Step title="Install the app" stepNumber={4} icon="terminal">Run it.</Step>',
        '<Step title="Plain" titleSize="p" id="plain-step">Then this.</Step>',
        '</Steps>',
    ].join('\n'))
    assert.match(html, /<li class="aiui-step" data-icon="" style="counter-set:aiui-step 4"><span class="aiui-step-icon"><svg/)
    assert.match(html, /<h3 class="aiui-step-title" id="install-the-app">Install the app<\/h3>/)
    assert.match(html, /<li class="aiui-step" id="plain-step"><p class="aiui-step-title">Plain<\/p>/)
})

test('accordion options: description, icon, id; defaultOpen still opens it; a bad id is dropped', () => {
    const html = renderDocs([
        '<Accordion title="FAQ" description="Short answers" icon="code" id="faq" defaultOpen>Body</Accordion>',
        '<Accordion title="Bad" id="x onclick=y">Body</Accordion>',
    ].join('\n'))
    assert.match(html, /<details id="faq" class="[^"]*" data-type="accordion" open="">\s*<summary[^>]*><svg[^>]*class="aiui-admonition-icon"[\s\S]*?FAQ<span class="aiui-admonition-desc[^"]*">Short answers<\/span><\/summary>/)
    assert.match(html, /<details class="[^"]*" data-type="accordion">\s*<summary[^>]*>Bad<\/summary>/)
})

test('tabs: defaultTabIndex picks the first tab shown, icon and id ride on the label, borderBottom adds the rule', () => {
    const html = renderDocs([
        '<Tabs defaultTabIndex={1} borderBottom>',
        '<Tab title="One">A</Tab>',
        '<Tab title="Two" icon="code" id="tab-two">B</Tab>',
        '</Tabs>',
    ].join('\n'))
    assert.match(html, /class="aiui-tabs my-4 min-w-0 aiui-tabs-rule"/)
    assert.match(html, /aria-selected="true"[^>]*><svg[^>]*class="aiui-tab-icon"[\s\S]*?<span id="tab-two" class="aiui-tab-label">Two<\/span>/)
    assert.match(html, /aria-selected="false"[^>]*><span class="aiui-tab-label">One<\/span>/)
})

test('<CodeGroup dropdown> keeps the group (attributes no longer break it) and draws a picker instead of tabs', () => {
    const md = ['<CodeGroup dropdown>', '', '```bash pip', 'pip install aiui', '```', '', '```bash uv', 'uv pip install aiui', '```', '', '</CodeGroup>'].join('\n')
    assert.match(preprocessMkdocsMarkdown(md), /<aiui-tabs variant="dropdown">[\s\S]*<aiui-tab title="pip">[\s\S]*<aiui-tab title="uv">/)
    const html = renderDocs(md)
    assert.match(html, /data-variant="dropdown"><div class="aiui-tabs-picker">/)
    assert.doesNotMatch(html, /role="tablist"/)
    assert.equal(html.match(/class="aiui-tabs-panel"/g)?.length, 2)
    assert.match(html, /class="aiui-tabs-panel" hidden="">/)
})
