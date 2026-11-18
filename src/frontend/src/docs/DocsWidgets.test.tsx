// Docs components (DocsWidgets.tsx) through the whole docs pipeline: tags → sanitizer → renderers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DOCS_TAG_COMPONENTS } from './DocsBlocks'
import { Markdown } from '../markdown/Markdown'
import { preprocessMkdocsMarkdown } from '../markdown/mkdocsPreprocess'
import { DOCS_ALLOWED_ELEMENTS, treeLists } from '../markdown/docsTags'

const render = (md: string) => renderToStaticMarkup(
    <Markdown variant="docs" components={DOCS_TAG_COMPONENTS} allowElements={DOCS_ALLOWED_ELEMENTS}>{preprocessMkdocsMarkdown(md)}</Markdown>,
)

test('<Callout icon color>: the colour becomes the tone, the icon replaces the default; a bad colour is dropped', () => {
    const html = render('<Callout icon="rocket" color="#FFC107">Custom **callout**.</Callout>\n\n<Callout color="red;background:url(x)" title="T">B</Callout>\n\n<Callout color="success">C</Callout>')
    assert.match(html, /data-type="callout" role="note" aria-label="Callout" style="--aiui-callout-accent:#FFC107" data-bare=""><svg[^>]*class="aiui-admonition-icon"/)
    assert.match(html, /Custom <span[^>]*>callout<\/span>/)
    assert.ok(!html.includes('url(x)'), html)
    assert.match(html, /aria-label="T"><p[^>]*>T<\/p>/)
    assert.match(html, /style="--aiui-callout-accent:var\(--success\)"/)
})

test('<Frame>: the caption and the hint are Markdown (links go through the docs link)', () => {
    const html = render('<Frame hint="Click **Run**." caption="**Note:** see [the guide](guide/x.md)">\n![alt](x.png)\n</Frame>')
    assert.match(html, /^<div[^>]*><div class="aiui-frame-hint"><div class="aiui-slot" data-slot="hint">\s*<p[^>]*>Click <span[^>]*>Run<\/span>/)
    assert.match(html, /<figure class="aiui-frame">[\s\S]*alt[\s\S]*<figcaption><div class="aiui-slot" data-slot="caption">\s*<p[^>]*><span[^>]*>Note:<\/span> see <(a|span)[^>]*>the guide/) // a real link; (under node the policy blocks relative links: no window)
    assert.ok(!html.includes('**'), html)
})

test('<Badge> and <Tooltip> stay inside their sentence; colours map to tokens', () => {
    const html = render('Status <Badge color="green" shape="pill" stroke>New</Badge> and <Badge disabled>Old</Badge>, see <Tooltip tip="Software Development Kit" headline="SDK" cta="Setup" href="guide/sdk.md">SDK</Tooltip>.')
    assert.match(html, /<p[^>]*>Status <span class="aiui-badge" data-shape="pill" data-stroke="" style="--aiui-tone:var\(--success\)">New<\/span> and <span class="aiui-badge" aria-disabled="true" style="--aiui-tone:var\(--muted-foreground\)">Old<\/span>/)
    assert.match(html, /<span class="aiui-tooltip" tabindex="0" aria-describedby="([^"]+)">SDK<span class="aiui-tooltip-tip" role="tooltip" id="\1"><strong>SDK<\/strong>Software Development Kit<a href="\/docs\/guide\/sdk">Setup<\/a><\/span><\/span>\.<\/p>/)
})

test('<Icon>: any lucide name, an emoji or an image, sized and coloured, inside its sentence', () => {
    const html = render('Go <Icon icon="rocket" size={32} color="#0f766e" /> or <Icon icon="flag" /> <Icon icon="🚀" size="12" /> <Icon icon="/i/x.svg" size={9999} color="red;x:url(y)" />.')
    assert.match(html, /<p[^>]*>Go <span class="aiui-icon" style="--aiui-icon-size:32px;color:#0f766e"><svg[^>]*><path /)
    assert.match(html, / or <span class="aiui-icon"><svg[^>]*><\/svg><\/span>/) // flag: its lazy chunk (no browser here)
    assert.match(html, /<span class="aiui-icon" style="--aiui-icon-size:12px"><span aria-hidden="true">🚀<\/span><\/span>/)
    assert.match(html, /<span class="aiui-icon"><img src="\/i\/x.svg" alt=""/) // too big a size and a bad colour are dropped
    assert.ok(!html.includes('url(y)'), html)
})

test('<Tile>: preview, Markdown title and description; the tile is the link', () => {
    const html = render('<Columns cols={2}>\n<Tile href="guide/install.md" title="Install the **CLI**" description="In minutes">\n![Preview](a.png)\n</Tile>\n</Columns>')
    assert.match(html, /<a class="aiui-tile" data-link="" href="\/docs\/guide\/install"><span class="aiui-tile-preview">[\s\S]*Preview[\s\S]*<\/span><div class="aiui-slot" data-slot="title">\s*<p[^>]*>Install the <span[^>]*>CLI<\/span><\/p>\s*<\/div><span class="aiui-tile-desc">In minutes<\/span><\/a>/)
})

test('<Prompt>: description, the prompt folded, and Copy / ChatGPT / Claude links that carry the prompt as written', () => {
    const md = ['<Prompt description="Write **docs**." actions={["copy", "claude", "cursor"]}>', 'You are a **writer**.', '- Use "you".', '</Prompt>'].join('\n')
    const html = render(md)
    const raw = encodeURIComponent('You are a **writer**.\n- Use "you".')
    assert.match(html, /<div class="aiui-prompt"><div class="aiui-prompt-head"><div class="aiui-slot" data-slot="description">\s*<p[^>]*>Write <span[^>]*>docs<\/span>/)
    assert.match(html, /<details><summary>Show prompt<\/summary><div class="aiui-prompt-body">\s*<p[^>]*>You are a <span[^>]*>writer<\/span>\.<\/p>\s*<ul[\s\S]*Use &quot;you&quot;/)
    assert.match(html, />Copy prompt<\/button>/)
    assert.ok(html.includes(`href="https://claude.ai/new?q=${raw}"`), html)
    assert.ok(html.includes(`href="https://cursor.com/link/prompt?text=${raw}"`), html)
    assert.ok(!html.includes('chatgpt.com'), html)
})

test('<Tree> around a Markdown list becomes folders (trailing / or children) and files; **name** is highlighted', () => {
    const md = ['<Tree>', '- app/', '  - layout.tsx', '  - **page.tsx**', '  - api', '    - route.ts', '- package.json', '</Tree>'].join('\n')
    assert.equal(treeLists(md), [
        '<Tree>', '<Tree.Folder name="app" defaultOpen>', '<Tree.File name="layout.tsx" />', '<Tree.File name="page.tsx" highlight />',
        '<Tree.Folder name="api" defaultOpen>', '<Tree.File name="route.ts" />', '</Tree.Folder>', '</Tree.Folder>', '<Tree.File name="package.json" />', '</Tree>',
    ].join('\n'))
    assert.equal(treeLists('```mdx\n<Tree>\n- a\n</Tree>\n```'), '```mdx\n<Tree>\n- a\n</Tree>\n```') // code is left alone
    const html = render(md)
    assert.match(html, /<div class="aiui-tree">\s*<details class="aiui-tree-folder" open=""><summary class="aiui-tree-row"><svg[\s\S]*?app<\/summary><div class="aiui-tree-children">/)
    assert.match(html, /<div class="aiui-tree-row aiui-tree-file" tabindex="0" data-hl="" aria-current="true"><svg[\s\S]*?page\.tsx<\/div>/)
})

test('<Tree.Folder> / <Tree.File> tags: closed by default, defaultOpen, openable={false}, highlight', () => {
    const html = render(['<FileTree>', '<Tree.Folder name="src">', '<Tree.File name="a.ts" />', '</Tree.Folder>', '<Tree.Folder name="fixed" openable={false} defaultOpen highlight>', '<Tree.File name="b.ts" />', '</Tree.Folder>', '</FileTree>'].join('\n'))
    assert.match(html, /<details class="aiui-tree-folder"><summary/)
    assert.match(html, /<div class="aiui-tree-folder" data-hl="" data-open=""><div class="aiui-tree-row" tabindex="0">/)
})

test('<Color>: swatches with a validated value, light/dark pairs, table rows with Markdown titles', () => {
    const html = render([
        '<Color variant="table">', '<Color.Row title="**Primary**">', '<Color.Item name="blue-500" value="#3B82F6" />',
        '<Color.Item name="bg" value={{ light: "#FFFFFF", dark: "oklch(20% 0.02 260)" }} />', '<Color.Item name="bad" value="red;background:url(x)" />',
        '</Color.Row>', '</Color>',
    ].join('\n'))
    assert.match(html, /<div class="aiui-colors" data-variant="table">\s*<div class="aiui-color-row">\s*<div class="aiui-slot" data-slot="title">\s*<p[^>]*><span[^>]*>Primary/)
    assert.match(html, /<button type="button" class="aiui-color" style="--aiui-swatch:#3B82F6;--aiui-swatch-dark:#3B82F6" aria-label="Copy blue-500, #3B82F6">/)
    assert.match(html, /--aiui-swatch:#FFFFFF;--aiui-swatch-dark:oklch\(20% 0.02 260\)" aria-label="Copy bg, #FFFFFF \/ oklch/)
    assert.ok(!html.includes('url(x)') && !html.includes('>bad<'), html)
})

test('table column widths: <colgroup><col width span> survive the sanitizer', () => {
    const html = render('<table><colgroup><col width="30%" span="2"><col width="120px" onclick="x()"></colgroup><tr><td>a</td><td>b</td><td>c</td></tr></table>')
    assert.match(html, /<colgroup><col width="30%" span="2"\/><col width="120px"\/><\/colgroup>/)
})
