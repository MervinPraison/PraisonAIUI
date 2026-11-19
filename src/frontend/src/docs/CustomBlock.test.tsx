// The site's own component tags (site.components): markdown/docsTags.ts turns a declared tag
// into <aiui-block>, the sanitizer keeps it, and docs/CustomBlock.tsx shows its body until the
// component loads (the e2e suite docs-components.spec.ts loads one).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DOCS_TAG_COMPONENTS } from './DocsBlocks'
import { Markdown } from '../markdown/Markdown'
import { preprocessMkdocsMarkdown } from '../markdown/mkdocsPreprocess'
import { DOCS_ALLOWED_ELEMENTS, expandDocsTags, jsonish } from '../markdown/docsTags'

const SITE = { Pricing: '/components/index.js?v=1', Price: '/components/index.js?v=1', Note: '/x.js' }
const props = (html: string) => JSON.parse(/props="([^"]*)"/.exec(html)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))

test('a declared tag becomes <aiui-block> with its props as values', () => {
    const md = expandDocsTags('<Pricing plan="pro" seats={3} yearly features={["a", "b"]} limits={{ calls: 10 }} label={"x"}>\n  Plans **start** free.\n</Pricing>', undefined, SITE)
    assert.match(md, /^<aiui-block tag="Pricing" src="\/components\/index.js\?v=1" props="[^"]*">$/m)
    assert.deepEqual(props(md), { plan: 'pro', seats: 3, yearly: true, features: ['a', 'b'], limits: { calls: 10 }, label: 'x' })
    assert.match(md, /^Plans \*\*start\*\* free\.$/m)
    assert.match(md, /^<\/aiui-block>$/m)
})

test('a self-closing tag inside a sentence stays in the sentence', () => {
    const md = expandDocsTags('From <Price plan="pro" /> a month.', undefined, SITE)
    assert.match(md, /^From <aiui-block tag="Price" [^>]*><\/aiui-block> a month\.$/m)
})

test('an undeclared tag is still dropped, and a built-in tag keeps its own meaning', () => {
    assert.doesNotMatch(expandDocsTags('<Gadget>\nbody\n</Gadget>', undefined, SITE), /aiui-block/)
    assert.match(expandDocsTags('<Note>\nbody\n</Note>', undefined, SITE), /aiui-admonition/)
})

test('jsonish reads JSON and JS-style objects; anything else stays text', () => {
    assert.deepEqual(jsonish("{ a: 'x', b: [1, 2,], }"), { a: 'x', b: [1, 2] })
    assert.equal(jsonish('42'), 42)
    assert.equal(jsonish('false'), false)
    assert.equal(jsonish('someVariable'), 'someVariable')
})

test('the page keeps <aiui-block> through the sanitizer and shows its Markdown body until the component loads', () => {
    const md = preprocessMkdocsMarkdown('<Pricing plan="pro" onclick="x" style="color:red">\n**Free** to start.\n</Pricing>', SITE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const render = (components: Record<string, ComponentType<any>>) => renderToStaticMarkup(
        <Markdown variant="docs" components={components} allowElements={DOCS_ALLOWED_ELEMENTS}>{md}</Markdown>,
    )
    const seen = render({ 'aiui-block': (p: Record<string, unknown>) => <i data-seen={JSON.stringify([p.tag, p.src, p.props, p.onclick ?? p.onClick, p.style])} /> })
    assert.ok(seen.includes(JSON.stringify(['Pricing', '/components/index.js?v=1', '{"plan":"pro","onclick":"x","style":"color:red"}', null, null]).replace(/"/g, '&quot;')), seen)
    const html = render(DOCS_TAG_COMPONENTS)
    assert.match(html, /data-streamdown="strong">Free<\/span> to start\./)
})
