/**
 * The lazy HTML parser (rehypeRawGate.ts, pluginLoaders.ts `needsRaw`):
 * `npm test -- rehypeRawGate`.
 *
 * In the build Streamdown's rehype-raw is the gate; in these tests Streamdown
 * keeps the real one (packages stay external), so the gate is checked on its
 * own: the hint never misses HTML in this repo's docs, rehype-raw changes
 * nothing in a tree without HTML (so skipping it there is safe), and the gate
 * loads and then runs the real plugin when it meets HTML.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { Root } from 'hast'
import rehypeRaw from 'rehype-raw'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { defaultRemarkPlugins } from 'streamdown'
import { unified, type PluggableList } from 'unified'
import { VFile } from 'vfile'
import { preprocessMkdocsMarkdown } from './mkdocsPreprocess'
import { prepareDocSource } from '@/docs/docSource'
import { getRawPlugin, needsRaw } from './pluginLoaders'
import rehypeRawGate, { hasRawNode } from './rehypeRawGate'

/** Streamdown's markdown → hast steps, before the rehype plugins. */
const toHast = (md: string): Root => {
    const processor = unified()
        .use(remarkParse)
        .use(Object.values(defaultRemarkPlugins) as PluggableList)
        .use(remarkRehype, { allowDangerousHtml: true })
    return processor.runSync(processor.parse(md)) as Root
}

type HastNode = { type: string; value?: string; children?: HastNode[] }

/**
 * The tree as JSON, ignoring what rehype-raw changes without changing the
 * page: positions, the root's `data.quirksMode`, and a text node split in two
 * (the DOM text is the same).
 */
function comparable(tree: unknown): string {
    const merge = (node: HastNode): HastNode => {
        if (!node.children) return node
        const children: HastNode[] = []
        for (const child of node.children.map(merge)) {
            const last = children.at(-1)
            if (child.type === 'text' && last?.type === 'text') children[children.length - 1] = { ...last, value: `${last.value}${child.value}` }
            else children.push(child)
        }
        return { ...node, children }
    }
    return JSON.stringify(merge(tree as HastNode), (key, value) => (key === 'position' || key === 'quirksMode' || value === false ? undefined : value))
        .replace(/,"data":\{\}\}$/, '}')
}

function markdownFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name)
        return statSync(full).isDirectory() ? markdownFiles(full) : name.endsWith('.md') ? [full] : []
    })
}

test('needsRaw: HTML outside code only', () => {
    const yes = [
        '<div>block</div>',
        'text <b>bold</b> text',
        '</span> closing',
        '<!-- comment -->',
        '<aiui-admonition type="note">x</aiui-admonition>',
        '```js\ncode\n```\n<p>after the fence</p>',
        '``` a`b\n<p>not a fence opener</p>\n```',
        '`a` <b>x</b> `c`',
        '    ```\n<div>indented four spaces is not a fence</div>',
    ]
    const no = [
        'no html at all',
        'a < b and c > d',
        'use `<Card>` in text',
        '```html\n<div>in a fence</div>\n```',
        '~~~\n<div>tilde fence</div>\n~~~',
        '````\n```\n<div>still inside the longer fence</div>\n````',
        '```\n<div>an unclosed fence runs to the end</div>',
        '<https://example.com> is an autolink, not HTML',
    ]
    for (const md of yes) assert.equal(needsRaw(md), true, md)
    for (const md of no.slice(0, -1)) assert.equal(needsRaw(md), false, md)
    // An autolink looks like a tag to the hint: loading the parser is the safe side.
    assert.equal(needsRaw(no.at(-1)!), true)
})

test("this repo's docs: the hint never misses HTML, and rehype-raw changes nothing without it", () => {
    const docs = path.resolve(process.cwd(), '../../docs')
    const files = markdownFiles(docs)
    assert.ok(files.length > 50, `found ${files.length} pages under ${docs}`)
    let plain = 0
    for (const file of files) {
        const md = preprocessMkdocsMarkdown(prepareDocSource(readFileSync(file, 'utf8'), '/docs/page'))
        const tree = toHast(md)
        if (needsRaw(md)) continue
        plain += 1
        assert.equal(hasRawNode(tree), false, `${path.relative(docs, file)} has HTML the hint missed`)
        const before = comparable(tree)
        const parsed = rehypeRaw()(structuredClone(tree), new VFile(md))
        assert.equal(comparable(parsed), before, `${path.relative(docs, file)} changes under rehype-raw`)
    }
    // Most pages have no HTML: those are the ones that skip the parser.
    assert.ok(plain > files.length / 2, `${plain} of ${files.length} pages without HTML`)
})

test('the gate passes a tree without HTML through and loads the parser for one with HTML', async () => {
    const plainTree = toHast('# Title\n\nA paragraph with `code` and a [link](/x).\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
    const before = comparable(plainTree)
    assert.equal(getRawPlugin(), null)
    assert.equal(comparable(rehypeRawGate()(plainTree, new VFile(''))), before)

    const htmlTree = toHast('before <b>bold</b> after')
    assert.equal(hasRawNode(htmlTree), true)
    rehypeRawGate()(htmlTree, new VFile('')) // not loaded yet: starts the load, leaves the tree
    for (let i = 0; i < 200 && !getRawPlugin(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
    assert.ok(getRawPlugin(), 'the gate started loading rehype-raw')

    const parsed = rehypeRawGate()(toHast('before <b>bold</b> after'), new VFile(''))
    assert.equal(hasRawNode(parsed), false)
    assert.match(JSON.stringify(parsed), /"tagName":"b"/)
})
