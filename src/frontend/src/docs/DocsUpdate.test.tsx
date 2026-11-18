// <Update> (DocsUpdate.tsx) through the docs pipeline, and its tag filter helpers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DOCS_TAG_COMPONENTS } from './DocsBlocks'
import { chosenTags, matches, withTags } from './DocsUpdate'
import { Markdown } from '../markdown/Markdown'
import { preprocessMkdocsMarkdown } from '../markdown/mkdocsPreprocess'
import { DOCS_ALLOWED_ELEMENTS } from '../markdown/docsTags'

const render = (md: string) => renderToStaticMarkup(
    <Markdown variant="docs" components={DOCS_TAG_COMPONENTS} allowElements={DOCS_ALLOWED_ELEMENTS}>{preprocessMkdocsMarkdown(md)}</Markdown>,
)

test('<Update>: the label is a section heading with an anchor, then description, tags and the Markdown body', () => {
    const html = render('<Update label="2026-11-18" description="v1.2" tags={["API", "Fix"]}>\nFaster **builds**.\n</Update>')
    assert.match(html, /<section class="aiui-update" data-tags="API,Fix"><div class="aiui-update-meta"><h2 id="2026-11-18" class="aiui-update-label">2026-11-18<\/h2>/)
    assert.match(html, /<p class="aiui-update-desc">v1.2<\/p><p class="aiui-update-tags"><span class="aiui-update-tag">API<\/span><span class="aiui-update-tag">Fix<\/span><\/p>/)
    assert.match(html, /<div class="aiui-update-body">\s*<p[^>]*>Faster <span[^>]*>builds<\/span>/)
})

test('<Update id> sets the anchor; markup in attributes stays text', () => {
    const html = render('<Update label="<img src=x onerror=alert(1)>" id="older" tags="a&quot;b">\nText\n</Update>')
    assert.match(html, /<h2 id="older" class="aiui-update-label">&lt;img src=x onerror=alert\(1\)&gt;<\/h2>/)
    assert.ok(!html.includes('<img'), html)
})

test('tag filter: ?tags= read and written, an entry shows with any chosen tag', () => {
    assert.deepEqual(chosenTags('?tags=API,Fix%20it'), ['API', 'Fix it'])
    assert.deepEqual(chosenTags(''), [])
    assert.equal(withTags('https://x.test/docs/changelog?a=1#v2', ['API', 'Fix']), '/docs/changelog?a=1&tags=API%2CFix#v2')
    assert.equal(withTags('https://x.test/docs/changelog?tags=API', []), '/docs/changelog')
    assert.ok(matches(['API'], []) && matches(['API', 'UI'], ['UI']))
    assert.ok(!matches(['API'], ['UI']) && !matches([], ['UI']))
})
