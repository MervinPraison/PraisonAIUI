// Ask AI's wire format (askStream.ts): Server-Sent Events from /api/docs/ask
// split across chunks, the request a static host sends, and [n] citations as
// links outside code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkCitations, parseEvents, streamAsk, type AskEvent, type AskSource } from './askStream'

const SOURCES: AskSource[] = [
    { n: 1, title: 'Install', heading: 'Using pip', path: '/docs/install#using-pip', url: '/docs/install#using-pip', snippet: '' },
    { n: 2, title: 'Themes', heading: '', path: '/docs/themes', url: '/base/docs/themes', snippet: '' },
]

test('parseEvents keeps an incomplete event for the next chunk', () => {
    const first = parseEvents('event: sources\ndata: []\n\nevent: text\ndata: {"text":"Hel')
    assert.deepEqual(first.events, [{ type: 'sources', sources: [] }])
    const second = parseEvents(first.rest + 'lo"}\n\nevent: done\ndata: {}\n\n')
    assert.deepEqual(second.events, [{ type: 'text', text: 'Hello' }, { type: 'done' }])
    assert.equal(second.rest, '')
})

test('parseEvents reads unavailable and error, and skips what it does not know', () => {
    const { events } = parseEvents('event: unavailable\ndata: {"message":"m"}\n\nevent: x\ndata: {}\n\nevent: text\ndata: nope\n\nevent: error\r\ndata: {"message":"e"}\r\n\r\n')
    assert.deepEqual(events, [{ type: 'unavailable', message: 'm' }, { type: 'error', message: 'e' }])
})

test('linkCitations links known numbers outside code only', () => {
    const md = 'Use pip [1][2], not [3]. See [docs](x) and `a[1]`.\n```\nlist[1]\n```\n[1]: footnote'
    const out = linkCitations(md, SOURCES)
    assert.ok(out.startsWith('Use pip [[1]](/docs/install#using-pip)[[2]](/base/docs/themes), not [3].'), out)
    assert.ok(out.includes('`a[1]`'))
    assert.ok(out.includes('\nlist[1]\n'))
    assert.ok(out.endsWith('[1]: footnote'))
})

function sse(chunks: string[]): Response {
    const body = new ReadableStream({
        start(c) {
            for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk))
            c.close()
        },
    })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

test('streamAsk posts the question and hands each event over', async () => {
    let sent: RequestInit | undefined
    const fake = (async (_url: string, init: RequestInit) => {
        sent = init
        return sse(['event: sources\ndata: [{"n":1}]\n\nevent: te', 'xt\ndata: {"text":"Hi [1]"}\n\nevent: done\ndata: {}\n\n'])
    }) as unknown as typeof fetch
    const events: AskEvent[] = []
    await streamAsk('/api/docs/ask', { question: 'q', page: '/docs/x' }, (e) => events.push(e), undefined, fake)
    assert.deepEqual(events.map((e) => e.type), ['sources', 'text', 'done'])
    assert.equal(sent?.method, 'POST')
    assert.deepEqual(JSON.parse(String(sent?.body)), { question: 'q', page: '/docs/x' })
})

test('streamAsk turns a refused or failed request into an error event', async () => {
    const events: AskEvent[] = []
    await streamAsk('/a', { question: 'q' }, (e) => events.push(e), undefined, (async () => new Response('', { status: 429 })) as unknown as typeof fetch)
    await streamAsk('/a', { question: 'q' }, (e) => events.push(e), undefined, (async () => { throw new Error('offline') }) as unknown as typeof fetch)
    assert.deepEqual(events.map((e) => e.type === 'error' && e.message.split('.')[0]), ['Too many questions', 'Could not reach the docs server'])
})
