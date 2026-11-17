// Page actions (pageActionLinks.ts): the published Markdown of a page and the assistant links.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assistantLinks, assistantPrompt, pageMarkdownPath } from './pageActionLinks'

test('every page publishes its Markdown next to it; the site root is docs/index.md', () => {
    assert.equal(pageMarkdownPath('/docs/getting-started/quickstart'), '/docs/getting-started/quickstart.md')
    assert.equal(pageMarkdownPath('/docs/guide/first/'), '/docs/guide/first.md')
    assert.equal(pageMarkdownPath('/'), '/docs/index.md')
    assert.equal(pageMarkdownPath(''), '/docs/index.md')
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
