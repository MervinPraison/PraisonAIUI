// Utility classes on docs pages (docsClasses.ts): through the docs page's Markdown pipeline, sanitizer included.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultRehypePlugins } from 'streamdown'
import { DOCS_TAG_COMPONENTS } from './DocsBlocks'
import { DocsImage } from './DocsMedia'
import { CLASS_PATTERNS, DOCS_CLASSES, DOCS_CLASS_RULES, DOCS_PAGE_ELEMENTS, expandBraces, rehypeDocsClasses } from './docsClasses'
import { Markdown } from '../markdown/Markdown'
import { preprocessMkdocsMarkdown } from '../markdown/mkdocsPreprocess'

const COMPONENTS = { ...DOCS_TAG_COMPONENTS, img: DocsImage }
const page = (md: string) => renderToStaticMarkup(
    <Markdown variant="docs" components={COMPONENTS} allowElements={DOCS_PAGE_ELEMENTS} beforeSanitize={rehypeDocsClasses}>
        {preprocessMkdocsMarkdown(md)}
    </Markdown>,
)
const classes = (html: string) => [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(' '))

test('raw HTML keeps the allowed utilities, renamed; other classes and style go', () => {
    for (const attr of ['className', 'class']) {
        const html = page(`<div ${attr}="grid md:grid-cols-2 gap-4 fixed inset-0 z-50" style="position:fixed">\n\n**Hi**\n\n</div>`)
        assert.match(html, /<div class="aiui:grid aiui:md:grid-cols-2 aiui:gap-4">\s*<p[^>]*><span[^>]*>Hi<\/span>/, html)
        assert.ok(!/fixed|inset|z-50|style=/.test(html), html)
    }
    assert.match(page('A <span className="text-muted-foreground dark:hidden">word</span>.'), /<span class="aiui:text-muted-foreground aiui:dark:hidden">word<\/span>/)
    // A tag over several lines works too: the sanitizer sees the parsed element.
    assert.match(page('<p\n  className="text-center text-sm"\n>Centered</p>'), /<p class="aiui:text-center aiui:text-sm"/)
})

test('component tags pass their allowed classes to the component root', () => {
    const card = page('<Card title="Start" className="mt-8 bg-muted shadow-2xl">Body</Card>')
    assert.match(card, /<div class="aiui-card aiui:mt-8 aiui:bg-muted"/, card)
    assert.ok(!card.includes('shadow'), card)
    assert.match(page('<Note className="md:hidden">Phones only</Note>'), /<div class="aiui-admonition [^"]*aiui:md:hidden"[^>]*role="note"/)
    assert.match(page('<CardGroup cols={2} class="gap-8">\n<Card title="A" />\n</CardGroup>'), /<div class="aiui-cards aiui:gap-8"/)
    assert.match(page('Text <Badge className="font-bold">New</Badge>'), /<span class="aiui-badge aiui:font-bold"/)
    assert.match(page('<Steps className="my-8">\n<Step title="One">a</Step>\n</Steps>'), /<ol class="aiui-steps aiui:my-8">/)
    assert.match(page('<Frame className="max-w-md">\n![A](/a.png)\n</Frame>'), /<figure class="aiui-frame aiui:max-w-md">/)
    // A component without classes renders exactly as before.
    assert.match(page('<Card title="Plain">Body</Card>'), /<div class="aiui-card">/)
})

test('images keep the light / dark classes (and any other allowed one) on the image', () => {
    const light = page('<img className="block dark:hidden rounded-none" src="/l.png" alt="L" />')
    assert.match(light, /<img[^>]* class="inline-block h-auto max-w-full rounded-lg align-middle aiui:block aiui:dark:hidden aiui:rounded-none" data-theme-only="light"/, light)
    assert.match(page('<img className="hidden dark:block" src="/d.png" alt="D" />'), /data-theme-only="dark"/)
})

test('markdown\'s own classes survive; a class in code is text', () => {
    assert.match(page('```js\nconst a = 1\n```'), /language-js/)
    const html = page('- [x] done\n\nNote[^1].\n\n[^1]: The note.\n\n`<div className="flex">`')
    for (const kept of ['contains-task-list', 'task-list-item', 'footnotes', 'sr-only', 'data-footnote-backref']) assert.ok(classes(html).includes(kept), kept)
    assert.match(html, /&lt;div className=&quot;flex&quot;&gt;/)
})

test('the chat keeps no class from a message', () => {
    const html = renderToStaticMarkup(<Markdown variant="chat">{'<div className="flex text-primary">x</div>'}</Markdown>)
    assert.ok(!/flex|text-primary/.test(html), html)
})

test('the allowlist: tokens only, no positioning, and every pattern in docs/utilities.css', () => {
    assert.ok(DOCS_CLASSES.size > 250)
    assert.deepEqual(expandBraces('a{b,c}-{1,2}'), ['ab-1', 'ab-2', 'ac-1', 'ac-2'])
    for (const c of DOCS_CLASSES) {
        assert.ok(!/(^|:)(fixed|absolute|sticky|z-|inset|top-|-\[)|-(red|blue|green|gray|zinc|slate)-\d/.test(c), c)
    }
    const css = readFileSync(path.resolve(process.cwd(), 'src/docs/utilities.css'), 'utf8')
    assert.deepEqual([...css.matchAll(/^@source inline\("aiui:(.*)"\);$/gm)].map((m) => m[1]), [...CLASS_PATTERNS])
})

test('class rules keep each class the base schema allows on that element', () => {
    const base = (defaultRehypePlugins.sanitize as unknown as [unknown, { attributes: Record<string, unknown[]> }])[1].attributes
    for (const [tag, rules] of Object.entries(base)) {
        const own = rules.find((r) => Array.isArray(r) && r[0] === 'className') as unknown[] | undefined
        if (!own) continue
        const mine = DOCS_CLASS_RULES[tag]?.[0]
        assert.ok(mine, tag)
        for (const v of own.slice(1)) assert.ok(mine.some((m) => String(m) === String(v)), `${tag}: ${String(v)}`)
    }
})
