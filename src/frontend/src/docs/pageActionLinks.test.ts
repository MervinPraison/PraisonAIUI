// Page actions (pageActionLinks.ts): the published Markdown of a page and the assistant links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_TARGETS, DEFAULT_PAGE_ACTIONS, actionGroup, assistantLinks, assistantPrompt, fillHref, isCopyPageShortcut, mcpLinks, pageActionList, promptLinks } from './pageActionLinks'
import { docPathToMarkdown } from '../pathUtils'

test('every page publishes its Markdown next to it; the site root is docs/index.md', () => {
    assert.equal(docPathToMarkdown('/docs/getting-started/quickstart'), '/docs/getting-started/quickstart.md')
    assert.equal(docPathToMarkdown('/docs/guide/first/'), '/docs/guide/first.md')
    assert.equal(docPathToMarkdown('/'), '/docs/index.md')
    assert.equal(docPathToMarkdown(''), '/docs/index.md')
})

test('assistant links open a new chat that reads the page, with the prompt URL-encoded', () => {
    const md = 'https://ui.praison.ai/docs/getting-started/quickstart.md'
    const links = assistantLinks(md, 'Quick Start')
    const prompt = assistantPrompt(md, 'Quick Start')
    assert.ok(prompt.includes(md) && prompt.includes('"Quick Start"'))
    assert.equal(links.chatgpt, `https://chatgpt.com/?hints=search&q=${encodeURIComponent(prompt)}`)
    assert.equal(links.claude, `https://claude.ai/new?q=${encodeURIComponent(prompt)}`)
    assert.ok(!links.claude.includes(' ') && !links.claude.includes('"'))
})

test('MCP links add the docs server to Cursor (base64 config) and VS Code (JSON, type http)', () => {
    const url = 'https://docs.acme.dev/mcp'
    const { cursor, vscode } = mcpLinks(url, 'acme-docs')
    const c = new URL(cursor)
    assert.equal(c.protocol, 'cursor:')
    assert.ok(cursor.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?'))
    assert.equal(c.searchParams.get('name'), 'acme-docs')
    assert.deepEqual(JSON.parse(atob(c.searchParams.get('config')!)), { url })
    assert.ok(vscode.startsWith('vscode:mcp/install?'))
    assert.deepEqual(JSON.parse(decodeURIComponent(vscode.slice('vscode:mcp/install?'.length))), { name: 'acme-docs', type: 'http', url })
})

test('every assistant target gets the encoded prompt appended, on https', () => {
    const links = promptLinks('Read "a & b"?')
    for (const [id, target] of Object.entries(AI_TARGETS)) {
        assert.equal(links[id as keyof typeof links], target.base + encodeURIComponent('Read "a & b"?'))
        assert.ok(target.base.startsWith('https://'))
    }
    assert.equal(links.perplexity, 'https://www.perplexity.ai/search/new?q=Read%20%22a%20%26%20b%22%3F')
    assert.ok(links.google.includes('udm=50'))
})

test('the page list wins over the site list, which wins over the default; false is none', () => {
    assert.deepEqual(pageActionList(), [...DEFAULT_PAGE_ACTIONS])
    assert.deepEqual(pageActionList(true, true), [...DEFAULT_PAGE_ACTIONS])
    assert.deepEqual(pageActionList(['grok', 'copy']), ['grok', 'copy'])
    assert.deepEqual(pageActionList(['grok', 'copy'], ['claude']), ['claude'])
    assert.deepEqual(pageActionList(['grok'], false), [])
    assert.deepEqual(pageActionList(false, ['copy']), ['copy'])
    assert.deepEqual(pageActionList(false), [])
    // Unknown ids, repeats and links without a label are dropped.
    const link = { label: 'Ask us', href: 'https://ask.acme.dev/?q={prompt}' }
    assert.deepEqual(pageActionList(['nope' as never, 'copy', 'copy', { label: '', href: '/x' }, link]), ['copy', link])
})

test('menu groups: the page, assistants, links of your own, the MCP server', () => {
    assert.deepEqual(['copy', 'listen', 'perplexity', 'mcp', { label: 'a', href: '/a' }].map((a) => actionGroup(a as never)), ['page', 'page', 'ai', 'mcp', 'link'])
})

test('a link of your own: placeholders filled in URL-encoded; script and data URLs refused', () => {
    const values = { url: 'https://d.dev/docs/a b', md: 'https://d.dev/docs/a.md', title: 'A & B', prompt: 'Read it?' }
    assert.equal(fillHref('https://x.dev/new?page={url}&md={md}&t={title}&q={prompt}', values),
        'https://x.dev/new?page=https%3A%2F%2Fd.dev%2Fdocs%2Fa%20b&md=https%3A%2F%2Fd.dev%2Fdocs%2Fa.md&t=A%20%26%20B&q=Read%20it%3F')
    assert.equal(fillHref('/support?from={url}', values), '/support?from=https%3A%2F%2Fd.dev%2Fdocs%2Fa%20b')
    assert.equal(fillHref('vscode:open?{md}', values), 'vscode:open?https%3A%2F%2Fd.dev%2Fdocs%2Fa.md')
    assert.equal(fillHref('javascript:alert({title})', values), null)
    assert.equal(fillHref(' JavaScript:alert(1)', values), null)
    assert.equal(fillHref('data:text/html,hi', values), null)
    assert.equal(fillHref('relative/path', values), null)
})

test('Cmd/Ctrl+C copies the page only with nothing selected and focus outside a text field', () => {
    const key = { key: 'c', metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, repeat: false, defaultPrevented: false }
    const body = { tagName: 'BODY' } as unknown as EventTarget
    assert.equal(isCopyPageShortcut(key, '', body), true)
    assert.equal(isCopyPageShortcut({ ...key, ctrlKey: false, metaKey: true, key: 'C' }, '', body), true)
    assert.equal(isCopyPageShortcut(key, 'some selected words', body), false)
    assert.equal(isCopyPageShortcut({ ...key, shiftKey: true }, '', body), false)
    assert.equal(isCopyPageShortcut({ ...key, ctrlKey: false }, '', body), false)
    assert.equal(isCopyPageShortcut({ ...key, key: 'v' }, '', body), false)
    assert.equal(isCopyPageShortcut({ ...key, defaultPrevented: true }, '', body), false)
    assert.equal(isCopyPageShortcut(key, '', { tagName: 'INPUT' } as unknown as EventTarget), false)
    assert.equal(isCopyPageShortcut(key, '', { tagName: 'TEXTAREA' } as unknown as EventTarget), false)
    assert.equal(isCopyPageShortcut(key, '', { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget), false)
    assert.equal(isCopyPageShortcut(key, '', null), true)
})
