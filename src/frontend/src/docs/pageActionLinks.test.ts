// Page actions (pageActionLinks.ts): the published Markdown of a page and the assistant links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assistantLinks, assistantPrompt, mcpLinks } from './pageActionLinks'
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
