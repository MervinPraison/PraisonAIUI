// The docs code frame (DocsPre.tsx) through the real docs renderer: options
// from the fence meta and notation comments become attributes and one scoped
// rule; notation never reaches the code; a plain fence gets no frame.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocsPre } from './DocsPre'
import { Markdown } from '../markdown/Markdown'
import { preprocessMkdocsMarkdown } from '../markdown/mkdocsPreprocess'

const COMPONENTS = { pre: DocsPre }
const render = (md: string) =>
    renderToStaticMarkup(<Markdown variant="docs" components={COMPONENTS}>{preprocessMkdocsMarkdown(md)}</Markdown>)

test('a plain fence renders as before, without a frame', () => {
    const html = render('```js\nconst a = 1\n```')
    assert.ok(!html.includes('aiui-code-frame'), html)
})

test('a multi-word title and flags: header text, gutter, wrap, no copy', () => {
    const html = render('```javascript Example title lines wrap nocopy\nconst a = 1\n```')
    assert.match(html, /<div class="aiui-code-title">Example title<\/div>/)
    for (const attr of ['data-titled', 'data-lines', 'data-wrap', 'data-nocopy']) assert.match(html, new RegExp(`${attr}=""`), attr)
    assert.match(html, /--aiui-ln-w:1ch/)
    assert.ok(!html.includes('>lines<'), html)
})

test('diff notation: markers leave the code, lines get add / remove / focus rules', () => {
    const html = render('```js focus={3}\nconst a = 1 // [!code --]\nconst a = 2 // [!code ++]\nuse(a)\n```')
    assert.ok(!html.includes('[!code'), html)
    assert.match(html, /data-diff=""/)
    assert.match(html, /:is\(:nth-child\(2\)\) \{ --aiui-line-bg: var\(--aiui-code-add\)/)
    assert.match(html, /:is\(:nth-child\(1\)\) \{ --aiui-line-bg: var\(--aiui-code-remove\)/)
    assert.match(html, /:not\(:hover, :focus-within\) pre > code > span:not\(:nth-child\(3\)\) \{ opacity/)
})

test('expandable: a long block collapses behind a "Show all" button; a short one does not', () => {
    const long = render('```py expandable\n' + Array.from({ length: 20 }, (_, i) => `x${i} = ${i}`).join('\n') + '\n```')
    assert.match(long, /data-collapsed=""/)
    assert.match(long, /<button type="button" class="aiui-code-more" aria-expanded="false">Show all 20 lines<\/button>/)
    assert.ok(!render('```py expandable\nx = 1\n```').includes('aiui-code-frame'))
})

test('<CodeBlock> renders like the fence, with its icon and highlighted line', () => {
    const html = render('<CodeBlock language="js" filename="cb.js" icon="terminal" highlight="[2]">\n  const x = 1\n  const y = 2\n</CodeBlock>')
    assert.match(html, /<div class="aiui-code-title"><svg[^>]*>[\s\S]*<\/svg>cb\.js<\/div>/)
    assert.match(html, /:is\(:nth-child\(2\)\) \{ --aiui-line-bg: var\(--aiui-code-hl\)/)
    assert.ok(!html.includes('CodeBlock'), html)
})
